import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnswerView,
  QuestionPage,
  QuestionView,
  SellerQuestionPage,
} from '@shopsphere/types';
import { displayName, autoFlagReason } from '../review/review-moderation';
import { decodeCursor } from '../review/review.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';

const QUESTION_INCLUDE = {
  answers: {
    where: { status: 'PUBLISHED' },
    // Seller answers first, then oldest first (the thread reads in order).
    orderBy: [{ sellerId: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    take: 10,
  },
} satisfies Prisma.QuestionInclude;
type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

/** Customer Q&A on the PDP (M6.3): ask, search, answers from sellers and customers. */
@Injectable()
export class QaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    productId: string,
    q: { q?: string; cursor?: string; limit?: number },
  ): Promise<QuestionPage> {
    const term = q.q?.trim();
    const where: Prisma.QuestionWhereInput = {
      productId,
      status: 'PUBLISHED',
      ...(term
        ? {
            OR: [
              { body: { contains: term, mode: 'insensitive' } },
              {
                answers: {
                  some: { status: 'PUBLISHED', body: { contains: term, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const limit = q.limit ?? 5;
    const skip = decodeCursor(q.cursor);
    const [rows, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        orderBy: [{ answerCount: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take: limit + 1,
        include: QUESTION_INCLUDE,
      }),
      this.prisma.question.count({ where }),
    ]);
    return {
      items: rows.slice(0, limit).map((r) => this.view(r)),
      nextCursor: rows.length > limit ? String(skip + limit) : null,
      total,
    };
  }

  async ask(userId: string, productId: string, body: string): Promise<QuestionView> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404);
    if (autoFlagReason(body))
      throw new AppError('VALIDATION_FAILED', 'Questions cannot contain links or contact details', 422);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const row = await this.prisma.question.create({
      data: {
        productId,
        userId,
        body,
        authorName: displayName(user?.name),
      },
      include: QUESTION_INCLUDE,
    });
    return this.view(row);
  }

  /** Customer answer; flagged as a verified buyer when they received the product. */
  async customerAnswer(userId: string, questionId: string, body: string): Promise<AnswerView> {
    const question = await this.requireQuestion(questionId);
    const [user, delivered] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      this.prisma.orderItem.findFirst({
        where: {
          productId: question.productId,
          order: { userId },
          shipment: { status: 'DELIVERED' },
        },
        select: { id: true },
      }),
    ]);
    return this.answer(question.id, body, {
      userId,
      sellerId: null,
      authorName: displayName(user?.name),
      verifiedBuyer: delivered !== null,
    });
  }

  /** Seller answer: only sellers with an offer on the product. */
  async sellerAnswer(
    userId: string,
    sellerId: string,
    questionId: string,
    body: string,
  ): Promise<AnswerView> {
    const question = await this.requireQuestion(questionId);
    const offer = await this.prisma.offer.findFirst({
      where: { sellerId, sku: { productId: question.productId } },
      select: { seller: { select: { name: true } } },
    });
    if (!offer)
      throw new AppError(
        'NOT_YOUR_PRODUCT',
        'You can only answer questions on products you sell',
        HttpStatus.FORBIDDEN,
      );
    return this.answer(question.id, body, {
      userId,
      sellerId,
      authorName: offer.seller.name,
      verifiedBuyer: false,
    });
  }

  /** Questions on the seller's products; `unanswered` = no answer from this seller yet. */
  async sellerQuestions(
    sellerId: string,
    q: { status?: 'unanswered' | 'answered' | 'all'; cursor?: string; limit?: number },
  ): Promise<SellerQuestionPage> {
    const status = q.status ?? 'unanswered';
    const mine = { some: { sellerId } };
    const where: Prisma.QuestionWhereInput = {
      status: 'PUBLISHED',
      productId: {
        in: (
          await this.prisma.sku.findMany({
            where: { offers: { some: { sellerId } } },
            select: { productId: true },
            distinct: ['productId'],
          })
        ).map((s) => s.productId),
      },
      ...(status === 'unanswered'
        ? { answers: { none: { sellerId } } }
        : status === 'answered'
          ? { answers: mine }
          : {}),
    };
    const limit = q.limit ?? 20;
    const skip = decodeCursor(q.cursor);
    const rows = await this.prisma.question.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip,
      take: limit + 1,
      include: QUESTION_INCLUDE,
    });
    const page = rows.slice(0, limit);
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(page.map((r) => r.productId))] } },
      select: { id: true, title: true, slug: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      items: page.map((r) => ({
        ...this.view(r),
        productTitle: byId.get(r.productId)?.title ?? '',
        productSlug: byId.get(r.productId)?.slug ?? '',
        answeredBySeller: r.answers.some((a) => a.sellerId === sellerId),
      })),
      nextCursor: rows.length > limit ? String(skip + limit) : null,
    };
  }

  private async requireQuestion(id: string) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question || question.status !== 'PUBLISHED')
      throw new AppError('QUESTION_NOT_FOUND', 'Question not found', 404);
    return question;
  }

  private async answer(
    questionId: string,
    body: string,
    by: { userId: string; sellerId: string | null; authorName: string; verifiedBuyer: boolean },
  ): Promise<AnswerView> {
    if (autoFlagReason(body))
      throw new AppError('VALIDATION_FAILED', 'Answers cannot contain links or contact details', 422);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.answer.create({ data: { questionId, body, ...by } });
      await tx.question.update({
        where: { id: questionId },
        data: { answerCount: { increment: 1 } },
      });
      return created;
    });
    return this.answerView(row);
  }

  private answerView(a: {
    id: string;
    body: string;
    authorName: string;
    sellerId: string | null;
    verifiedBuyer: boolean;
    createdAt: Date;
  }): AnswerView {
    return {
      id: a.id,
      body: a.body,
      authorName: a.authorName,
      isSeller: a.sellerId !== null,
      verifiedBuyer: a.verifiedBuyer,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private view(r: QuestionRow): QuestionView {
    return {
      id: r.id,
      productId: r.productId,
      body: r.body,
      authorName: r.authorName,
      answerCount: r.answerCount,
      answers: r.answers.map((a) => this.answerView(a)),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
