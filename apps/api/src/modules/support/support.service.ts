import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CreateTicketRequest,
  HelpArticle,
  SupportTicket,
  TicketCategory,
  TicketStatus,
} from '@shopsphere/types';
import { randomInt } from 'node:crypto';
import { isUuid } from '../order/order.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { HELP_ARTICLES } from './help-articles';

type TicketRow = Prisma.SupportTicketGetPayload<object>;

/** "SR" + yymmdd (UTC) + 6 random digits. */
export function newTicketNumber(now = new Date()): string {
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  return `SR${d}${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
}

/** Help centre (static articles) + support tickets linked to orders (M6.8). */
@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  articles(q?: string): HelpArticle[] {
    const term = q?.trim().toLowerCase();
    if (!term) return HELP_ARTICLES;
    return HELP_ARTICLES.filter((a) =>
      [a.title, a.summary, a.topic, ...a.body].some((t) => t.toLowerCase().includes(term)),
    );
  }

  article(slug: string): HelpArticle {
    const a = HELP_ARTICLES.find((x) => x.slug === slug);
    if (!a) throw new AppError('NOT_FOUND', 'Article not found', HttpStatus.NOT_FOUND);
    return a;
  }

  async create(userId: string, body: CreateTicketRequest): Promise<SupportTicket> {
    if (body.orderId) {
      const owned = isUuid(body.orderId)
        ? await this.prisma.order.count({ where: { id: body.orderId, userId } })
        : 0;
      if (!owned) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    }
    const row = await this.prisma.supportTicket.create({
      data: {
        number: newTicketNumber(),
        userId,
        orderId: body.orderId ?? null,
        category: body.category,
        subject: body.subject.trim(),
        message: body.message.trim(),
      },
    });
    return (await this.views([row]))[0];
  }

  async list(userId: string): Promise<{ items: SupportTicket[] }> {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { items: await this.views(rows) };
  }

  private async views(rows: TicketRow[]): Promise<SupportTicket[]> {
    const ids = rows.map((r) => r.orderId).filter((x): x is string => !!x);
    const orders = ids.length
      ? await this.prisma.order.findMany({
          where: { id: { in: ids } },
          select: { id: true, number: true },
        })
      : [];
    const numbers = new Map(orders.map((o) => [o.id, o.number]));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      category: r.category as TicketCategory,
      orderId: r.orderId,
      orderNumber: r.orderId ? (numbers.get(r.orderId) ?? null) : null,
      subject: r.subject,
      message: r.message,
      status: r.status as TicketStatus,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
