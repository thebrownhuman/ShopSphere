import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AdminReviewPage,
  AdminReviewView,
  AggregateRunSummary,
  ReportReason,
  ReviewEligibility,
  ReviewMediaUploadResponse,
  ReviewModerationRequest,
  ReviewPage,
  ReviewSort,
  ReviewStats,
  ReviewStatus,
  ReviewSummaryWrite,
  ReviewTheme,
  ReviewView,
  ReviewVoteResponse,
  SummaryCandidate,
} from '@shopsphere/types';
import { SearchIndexerService } from '../search/search-indexer.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { aggregate, toHistogram } from './review-aggregate';
import { ReviewMediaStore } from './review-media.store';
import { autoFlagReason, displayName, REPORT_THRESHOLD } from './review-moderation';

const REVIEW_INCLUDE = { images: { orderBy: { position: 'asc' } } } as const;
type ReviewRow = Prisma.ReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>;

export interface ReviewListQuery {
  stars?: number[];
  verified?: boolean;
  withImages?: boolean;
  sort?: ReviewSort;
  cursor?: string;
  limit?: number;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES = 5;

/** Offset cursors: lists are short and re-sorted by votes, so keyset paging buys little here. */
export function decodeCursor(cursor: string | undefined): number {
  const n = Number(cursor ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Reviews (M6.2): verified-buyer gate, photos, votes, reports, moderation, aggregates. */
@Injectable()
export class ReviewService {
  private readonly log = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: ReviewMediaStore,
    private readonly indexer: SearchIndexerService,
  ) {}

  /** A delivered shipment containing the product, on one of the user's orders. */
  async deliveredOrderId(userId: string, productId: string): Promise<string | null> {
    const item = await this.prisma.orderItem.findFirst({
      where: { productId, order: { userId }, shipment: { status: 'DELIVERED' } },
      select: { orderId: true },
      orderBy: { shipment: { deliveredAt: 'desc' } },
    });
    return item?.orderId ?? null;
  }

  async eligibility(userId: string, productId: string): Promise<ReviewEligibility> {
    const [existing, votes] = await Promise.all([
      this.prisma.review.findUnique({
        where: { userId_productId: { userId, productId } },
        select: { id: true },
      }),
      this.prisma.reviewVote.findMany({
        where: { userId, review: { productId } },
        select: { reviewId: true },
      }),
    ]);
    const votedReviewIds = votes.map((v) => v.reviewId);
    if (existing)
      return { eligible: false, reason: 'ALREADY_REVIEWED', reviewId: existing.id, votedReviewIds };
    const orderId = await this.deliveredOrderId(userId, productId);
    return {
      eligible: orderId !== null,
      reason: orderId ? null : 'NOT_DELIVERED',
      reviewId: null,
      votedReviewIds,
    };
  }

  async uploadImage(
    userId: string,
    req: { fileName: string; contentType: string; dataBase64: string },
  ): Promise<ReviewMediaUploadResponse> {
    const bytes = Buffer.from(req.dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
      throw new AppError('UPLOAD_INVALID', 'Photos must be up to 2 MB', 422);
    const id = randomUUID();
    const key = `reviews/${id}.${EXT[req.contentType]}`;
    await this.media.put(key, bytes, req.contentType);
    await this.prisma.reviewImage.create({
      data: {
        id,
        userId,
        storageKey: key,
        contentType: req.contentType,
        sizeBytes: bytes.length,
      },
    });
    return { id, url: this.media.url(key) };
  }

  async create(
    userId: string,
    productId: string,
    req: { rating: number; title: string; body: string; imageIds?: string[] },
  ): Promise<ReviewView> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) throw new AppError('PRODUCT_NOT_FOUND', 'Product not found', 404);
    const orderId = await this.deliveredOrderId(userId, productId);
    if (!orderId)
      throw new AppError(
        'REVIEW_NOT_ELIGIBLE',
        'Only customers who received this product can review it',
        HttpStatus.FORBIDDEN,
      );
    const imageIds = [...new Set(req.imageIds ?? [])].slice(0, MAX_IMAGES);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const flag = autoFlagReason(`${req.title}\n${req.body}`);

    const review = await this.prisma.$transaction(async (tx) => {
      const images = await tx.reviewImage.findMany({
        where: { id: { in: imageIds }, userId, reviewId: null },
        select: { id: true },
      });
      if (images.length !== imageIds.length)
        throw new AppError('UPLOAD_INVALID', 'Unknown or already used photo', 422);
      let created;
      try {
        created = await tx.review.create({
          data: {
            productId,
            userId,
            orderId,
            rating: req.rating,
            title: req.title,
            body: req.body,
            authorName: displayName(user?.name),
            status: flag ? 'PENDING' : 'PUBLISHED',
            moderationNote: flag,
            imageCount: imageIds.length,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new AppError('REVIEW_EXISTS', 'You have already reviewed this product', 409);
        throw e;
      }
      for (const [position, id] of imageIds.entries())
        await tx.reviewImage.update({ where: { id }, data: { reviewId: created.id, position } });
      await this.queue(tx, productId);
      return tx.review.findUniqueOrThrow({ where: { id: created.id }, include: REVIEW_INCLUDE });
    });
    await this.refreshNow(productId);
    return this.view(review);
  }

  async list(productId: string, q: ReviewListQuery): Promise<ReviewPage> {
    const where: Prisma.ReviewWhereInput = {
      productId,
      status: 'PUBLISHED',
      ...(q.stars?.length ? { rating: { in: q.stars } } : {}),
      ...(q.withImages ? { imageCount: { gt: 0 } } : {}),
      // Every review comes from a verified buyer; the filter is kept for the UI contract.
    };
    const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
      q.sort === 'recent'
        ? [{ createdAt: 'desc' }]
        : q.sort === 'rating_desc'
          ? [{ rating: 'desc' }, { createdAt: 'desc' }]
          : q.sort === 'rating_asc'
            ? [{ rating: 'asc' }, { createdAt: 'desc' }]
            : [{ helpfulCount: 'desc' }, { createdAt: 'desc' }];
    const limit = q.limit ?? 10;
    const skip = decodeCursor(q.cursor);
    const [rows, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: [...orderBy, { id: 'asc' }],
        skip,
        take: limit + 1,
        include: REVIEW_INCLUDE,
      }),
      this.prisma.review.count({ where }),
    ]);
    return {
      items: rows.slice(0, limit).map((r) => this.view(r)),
      nextCursor: rows.length > limit ? String(skip + limit) : null,
      total,
    };
  }

  async stats(productId: string): Promise<ReviewStats> {
    const [groups, withImages, summary] = await Promise.all([
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { productId, status: 'PUBLISHED' },
        _count: { _all: true },
      }),
      this.prisma.review.count({ where: { productId, status: 'PUBLISHED', imageCount: { gt: 0 } } }),
      this.prisma.reviewSummary.findUnique({ where: { productId } }),
    ]);
    const histogram = toHistogram(groups.map((g) => ({ rating: g.rating, count: g._count._all })));
    const agg = aggregate(histogram);
    return {
      productId,
      rating: agg.ratingX10 / 10,
      ratingCount: agg.count,
      histogram,
      withImages,
      summary: summary
        ? {
            summary: summary.summary,
            themes: summary.themes as unknown as ReviewTheme[],
            source: summary.source === 'claude' ? 'claude' : 'offline',
            reviewCount: summary.reviewCount,
            generatedAt: summary.generatedAt.toISOString(),
          }
        : null,
    };
  }

  /** Idempotent: the (review, user) key admits one vote; the counter moves only on a change. */
  async vote(userId: string, reviewId: string, helpful: boolean): Promise<ReviewVoteResponse> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review || review.status !== 'PUBLISHED')
      throw new AppError('REVIEW_NOT_FOUND', 'Review not found', 404);
    if (review.userId === userId)
      throw new AppError('VALIDATION_FAILED', 'You cannot vote on your own review', 422);
    return this.prisma.$transaction(async (tx) => {
      let delta = 0;
      if (helpful) {
        const res = await tx.reviewVote.createMany({
          data: [{ reviewId, userId }],
          skipDuplicates: true,
        });
        delta = res.count;
      } else {
        const res = await tx.reviewVote.deleteMany({ where: { reviewId, userId } });
        delta = -res.count;
      }
      const updated =
        delta === 0
          ? await tx.review.findUniqueOrThrow({ where: { id: reviewId } })
          : await tx.review.update({
              where: { id: reviewId },
              data: { helpfulCount: { increment: delta } },
            });
      return { reviewId, helpfulCount: updated.helpfulCount, voted: helpful };
    });
  }

  async report(
    userId: string,
    reviewId: string,
    req: { reason: ReportReason; note?: string },
  ): Promise<{ reported: true }> {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new AppError('REVIEW_NOT_FOUND', 'Review not found', 404);
    const requeued = await this.prisma.$transaction(async (tx) => {
      const res = await tx.reviewReport.createMany({
        data: [{ reviewId, userId, reason: req.reason, note: req.note ?? null }],
        skipDuplicates: true,
      });
      if (res.count === 0) return false;
      const updated = await tx.review.update({
        where: { id: reviewId },
        data: { reportCount: { increment: 1 } },
      });
      // Back to the queue once enough distinct shoppers report it (and no moderator kept it).
      if (
        updated.status === 'PUBLISHED' &&
        updated.reportCount >= REPORT_THRESHOLD &&
        updated.moderatedAt === null
      ) {
        await tx.review.update({
          where: { id: reviewId },
          data: { status: 'PENDING', moderationNote: 'REPORTED' },
        });
        await this.queue(tx, review.productId);
        return true;
      }
      return false;
    });
    if (requeued) await this.refreshNow(review.productId);
    return { reported: true };
  }

  // ───────── Moderation ─────────

  async adminList(q: {
    status?: ReviewStatus;
    reported?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<AdminReviewPage> {
    const limit = q.limit ?? 20;
    const skip = decodeCursor(q.cursor);
    const rows = await this.prisma.review.findMany({
      where: {
        status: q.status ?? 'PENDING',
        ...(q.reported ? { reportCount: { gt: 0 } } : {}),
      },
      orderBy: [{ reportCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      skip,
      take: limit + 1,
      include: { ...REVIEW_INCLUDE, reports: { orderBy: { createdAt: 'asc' } } },
    });
    const items = await this.adminViews(rows.slice(0, limit));
    return { items, nextCursor: rows.length > limit ? String(skip + limit) : null };
  }

  async adminGet(id: string): Promise<AdminReviewView> {
    const row = await this.prisma.review.findUnique({
      where: { id },
      include: { ...REVIEW_INCLUDE, reports: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw new AppError('REVIEW_NOT_FOUND', 'Review not found', 404);
    return (await this.adminViews([row]))[0];
  }

  async moderate(id: string, req: ReviewModerationRequest): Promise<AdminReviewView> {
    const row = await this.prisma.review.findUnique({ where: { id } });
    if (!row) throw new AppError('REVIEW_NOT_FOUND', 'Review not found', 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.review.update({
        where: { id },
        data: {
          status: req.action === 'approve' ? 'PUBLISHED' : 'REJECTED',
          moderationNote: req.note ?? row.moderationNote,
          moderatedAt: new Date(),
        },
      });
      await this.queue(tx, row.productId);
    });
    await this.refreshNow(row.productId);
    return this.adminGet(id);
  }

  // ───────── Aggregates (job) ─────────

  private async queue(tx: Prisma.TransactionClient, productId: string): Promise<void> {
    await tx.reviewAggregateQueue.upsert({
      where: { productId },
      create: { productId },
      update: { queuedAt: new Date() },
    });
  }

  /** Inline refresh after a write so the PDP shows it at once; the job retries on failure. */
  private async refreshNow(productId: string): Promise<void> {
    await this.refreshAggregates([productId]).catch((e: unknown) =>
      this.log.warn(`inline aggregate refresh failed for ${productId}: ${String(e)}`),
    );
  }

  /**
   * Recomputes products.rating_x10 / rating_count from published reviews and reindexes them.
   * Without ids, drains the queue (oldest first). Queue rows are removed only after the update,
   * and only if not re-queued meanwhile, so a concurrent write is never lost.
   */
  async refreshAggregates(productIds?: string[], limit = 200): Promise<AggregateRunSummary> {
    const queued = productIds
      ? await this.prisma.reviewAggregateQueue.findMany({ where: { productId: { in: productIds } } })
      : await this.prisma.reviewAggregateQueue.findMany({ orderBy: { queuedAt: 'asc' }, take: limit });
    const ids = productIds ?? queued.map((q) => q.productId);
    if (ids.length === 0) return { products: 0, indexed: 0 };
    const groups = await this.prisma.review.groupBy({
      by: ['productId', 'rating'],
      where: { productId: { in: ids }, status: 'PUBLISHED' },
      _count: { _all: true },
    });
    for (const productId of ids) {
      const agg = aggregate(
        toHistogram(
          groups
            .filter((g) => g.productId === productId)
            .map((g) => ({ rating: g.rating, count: g._count._all })),
        ),
      );
      await this.prisma.product.updateMany({
        where: { id: productId },
        data: { ratingX10: agg.ratingX10, ratingCount: agg.count },
      });
    }
    const indexed = await this.indexer.indexProducts(ids);
    for (const q of queued)
      await this.prisma.reviewAggregateQueue.deleteMany({
        where: { productId: q.productId, queuedAt: { lte: q.queuedAt } },
      });
    return { products: ids.length, indexed };
  }

  // ───────── Summaries (M6.4 job) ─────────

  /** Products whose cached summary is missing or built from a different review count. */
  async summaryCandidates(limit = 20, maxReviews = 60): Promise<SummaryCandidate[]> {
    const rows = await this.prisma.$queryRaw<{ product_id: string; title: string; n: number }[]>`
      SELECT r.product_id, p.title, COUNT(*)::int AS n
      FROM reviews r
      JOIN products p ON p.id = r.product_id
      LEFT JOIN review_summaries s ON s.product_id = r.product_id
      WHERE r.status = 'PUBLISHED'
      GROUP BY r.product_id, p.title, s.review_count
      HAVING s.review_count IS NULL OR s.review_count <> COUNT(*)
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}`;
    const out: SummaryCandidate[] = [];
    for (const row of rows) {
      const reviews = await this.prisma.review.findMany({
        where: { productId: row.product_id, status: 'PUBLISHED' },
        orderBy: [{ helpfulCount: 'desc' }, { createdAt: 'desc' }],
        take: maxReviews,
        select: { rating: true, title: true, body: true },
      });
      out.push({
        productId: row.product_id,
        productTitle: row.title,
        reviews,
        reviewCount: row.n,
      });
    }
    return out;
  }

  async saveSummary(productId: string, w: ReviewSummaryWrite): Promise<{ saved: true }> {
    const data = {
      summary: w.summary,
      themes: w.themes as unknown as Prisma.InputJsonValue,
      source: w.source,
      model: w.model,
      reviewCount: w.reviewCount,
      generatedAt: new Date(),
    };
    await this.prisma.reviewSummary.upsert({
      where: { productId },
      create: { productId, ...data },
      update: data,
    });
    return { saved: true };
  }

  // ───────── Views ─────────

  private view(r: ReviewRow): ReviewView {
    return {
      id: r.id,
      productId: r.productId,
      rating: r.rating,
      title: r.title,
      body: r.body,
      authorName: r.authorName,
      verifiedBuyer: true,
      helpfulCount: r.helpfulCount,
      images: r.images.map((i) => ({ id: i.id, url: this.media.url(i.storageKey) })),
      createdAt: r.createdAt.toISOString(),
      status: r.status as ReviewStatus,
    };
  }

  private async adminViews(
    rows: (ReviewRow & { reports: { reason: string; note: string | null; createdAt: Date }[] })[],
  ): Promise<AdminReviewView[]> {
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.productId))] } },
      select: { id: true, title: true, slug: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => ({
      ...this.view(r),
      userId: r.userId,
      orderId: r.orderId,
      productTitle: byId.get(r.productId)?.title ?? '',
      productSlug: byId.get(r.productId)?.slug ?? '',
      reportCount: r.reportCount,
      moderationNote: r.moderationNote,
      reports: r.reports.map((p) => ({
        reason: p.reason as ReportReason,
        note: p.note,
        createdAt: p.createdAt.toISOString(),
      })),
      moderatedAt: r.moderatedAt?.toISOString() ?? null,
    }));
  }
}
