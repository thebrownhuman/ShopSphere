import { HttpStatus, Injectable } from '@nestjs/common';
import type { FraudAssessment, Prisma } from '@prisma/client';
import type { FraudAssessmentView, FraudThresholdsView, Page } from '@shopsphere/types';
import { OrderService } from '../order/order.service';
import { AuditService } from '../shared/audit/audit.service';
import { AppConfig } from '../shared/config/config.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import {
  decisionOf,
  scoreOrder,
  type FraudFacts,
  type FraudResult,
  type FraudThresholds,
} from './fraud-rules';

const HOUR = 3_600_000;
/** Loopback = same-host traffic (local stack, health probes): never IP-velocity scored. */
const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;
const DAY = 24 * HOUR;

export interface FraudContext {
  ip: string | null;
  deviceId: string | null;
}

export interface FraudOrderInput {
  userId: string;
  checkoutId: string;
  paymentMethod: FraudFacts['paymentMethod'];
  totalPaise: number;
  shippingState: string;
}

export interface Assessment {
  input: FraudOrderInput;
  ctx: FraudContext;
  result: FraudResult;
}

/** Fraud scoring v1 (M7.2): gathers velocity/device/account facts, scores, records, reviews. */
@Injectable()
export class FraudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly orders: OrderService,
    private readonly audit: AuditService,
  ) {}

  thresholds(): FraudThresholds & FraudThresholdsView {
    const c = this.config;
    return {
      forcePrepaidScore: c.get('FRAUD_FORCE_PREPAID_SCORE'),
      reviewScore: c.get('FRAUD_REVIEW_SCORE'),
      captchaScore: c.get('FRAUD_CAPTCHA_SCORE'),
      highValuePaise: c.get('FRAUD_HIGH_VALUE_PAISE'),
      newAccountDays: c.get('FRAUD_NEW_ACCOUNT_DAYS'),
      userOrdersPerHour: c.get('FRAUD_USER_ORDERS_PER_HOUR'),
      deviceOrdersPerHour: c.get('FRAUD_DEVICE_ORDERS_PER_HOUR'),
      deviceUsersPerDay: c.get('FRAUD_DEVICE_USERS_PER_DAY'),
      ipOrdersPerHour: c.get('FRAUD_IP_ORDERS_PER_HOUR'),
    };
  }

  /** Full assessment at place-order time (request context known). */
  async assess(input: FraudOrderInput, ctx: FraudContext, now = new Date()): Promise<Assessment> {
    const facts = await this.facts(input, ctx, now);
    return { input, ctx, result: scoreOrder(facts, this.thresholds()) };
  }

  /**
   * Checkout quote preview: would COD be refused? Device/IP are unknown here, so only account
   * signals count; place-order re-scores with the full context and stays authoritative.
   */
  async codRefused(input: Omit<FraudOrderInput, 'paymentMethod' | 'checkoutId'>): Promise<boolean> {
    const facts = await this.facts(
      { ...input, checkoutId: '', paymentMethod: 'COD' },
      { ip: null, deviceId: null },
      new Date(),
    );
    // No device on a preview is "unknown", not "missing".
    return scoreOrder({ ...facts, deviceId: 'preview' }, this.thresholds()).forcePrepaid;
  }

  private async facts(i: FraudOrderInput, ctx: FraudContext, now: Date): Promise<FraudFacts> {
    const hourAgo = new Date(now.getTime() - HOUR);
    const dayAgo = new Date(now.getTime() - DAY);
    const scored = { orderId: { not: null } };
    const device = ctx.deviceId;
    const [user, billing, priorOrders, userOrdersLastHour, deviceOrders, deviceUsers, ipOrders] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { id: i.userId }, select: { createdAt: true } }),
        this.prisma.address.findFirst({
          where: { userId: i.userId, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: { state: true },
        }),
        this.prisma.order.count({ where: { userId: i.userId } }),
        this.prisma.order.count({ where: { userId: i.userId, placedAt: { gt: hourAgo } } }),
        device
          ? this.prisma.fraudAssessment.count({
              where: { deviceId: device, createdAt: { gt: hourAgo }, ...scored },
            })
          : Promise.resolve(0),
        device
          ? this.prisma.fraudAssessment.findMany({
              where: { deviceId: device, createdAt: { gt: dayAgo }, ...scored },
              distinct: ['userId'],
              select: { userId: true },
            })
          : Promise.resolve([] as { userId: string }[]),
        ctx.ip && !LOOPBACK.test(ctx.ip)
          ? this.prisma.fraudAssessment.count({
              where: { ip: ctx.ip, createdAt: { gt: hourAgo }, ...scored },
            })
          : Promise.resolve(0),
      ]);
    const users = new Set(deviceUsers.map((d) => d.userId));
    if (device) users.add(i.userId);
    return {
      paymentMethod: i.paymentMethod,
      totalPaise: i.totalPaise,
      priorOrders,
      accountAgeDays: user ? Math.floor((now.getTime() - user.createdAt.getTime()) / DAY) : 0,
      userOrdersLastHour,
      deviceId: device,
      deviceOrdersLastHour: deviceOrders,
      deviceUsersLastDay: users.size,
      ipOrdersLastHour: ipOrders,
      billingState: billing?.state ?? null,
      shippingState: i.shippingState,
    };
  }

  /** Persist the score (orderId null = attempt refused before an order existed). */
  async record(a: Assessment, orderId: string | null, tx?: Tx): Promise<void> {
    const r = a.result;
    await (tx ?? this.prisma).fraudAssessment.create({
      data: {
        orderId,
        userId: a.input.userId,
        checkoutId: a.input.checkoutId,
        score: r.score,
        decision: decisionOf(r),
        signals: r.signals as unknown as Prisma.InputJsonValue,
        paymentMethod: a.input.paymentMethod,
        totalPaise: BigInt(a.input.totalPaise),
        ip: a.ctx.ip,
        deviceId: a.ctx.deviceId,
        reviewStatus: orderId && r.manualReview ? 'PENDING_REVIEW' : 'NONE',
      },
    });
  }

  // ───────── Admin review queue ─────────

  async list(q: {
    status?: string;
    page: number;
    pageSize: number;
  }): Promise<Page<FraudAssessmentView>> {
    const where: Prisma.FraudAssessmentWhereInput = q.status
      ? { reviewStatus: q.status }
      : { OR: [{ reviewStatus: { not: 'NONE' } }, { decision: { not: 'ALLOW' } }] };
    const [rows, total] = await Promise.all([
      this.prisma.fraudAssessment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.fraudAssessment.count({ where }),
    ]);
    return { items: await this.views(rows), total, page: q.page, pageSize: q.pageSize };
  }

  async approve(id: string, staffId: string, note?: string): Promise<FraudAssessmentView> {
    await this.prisma.$transaction(async (tx) => {
      const a = await this.pending(tx, id);
      await tx.order.update({ where: { id: a.orderId! }, data: { fraudHold: false } });
      await this.review(tx, a, 'APPROVED', staffId, note);
    });
    return this.view(id);
  }

  /** Reject = cancel the held order (stock back, refunds via the normal cancel path). */
  async reject(id: string, staffId: string, note?: string): Promise<FraudAssessmentView> {
    const a = await this.prisma.$transaction(async (tx) => {
      const row = await this.pending(tx, id);
      await this.review(tx, row, 'REJECTED', staffId, note);
      return row;
    });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: a.orderId! } });
    await this.orders.cancel(order.userId, order.id, 'Cancelled after fraud review', 'admin');
    await this.prisma.order.update({ where: { id: order.id }, data: { fraudHold: false } });
    return this.view(id);
  }

  private async pending(tx: Tx, id: string): Promise<FraudAssessment> {
    await tx.$queryRaw`SELECT id FROM fraud_assessments WHERE id = ${id}::uuid FOR UPDATE`;
    const a = await tx.fraudAssessment.findUnique({ where: { id } });
    if (!a) throw new AppError('NOT_FOUND', 'Assessment not found', HttpStatus.NOT_FOUND);
    if (a.reviewStatus !== 'PENDING_REVIEW' || !a.orderId) {
      throw new AppError('REVIEW_NOT_PENDING', `Assessment is ${a.reviewStatus}`, 409);
    }
    return a;
  }

  private async review(
    tx: Tx,
    a: FraudAssessment,
    status: 'APPROVED' | 'REJECTED',
    staffId: string,
    note?: string,
  ): Promise<void> {
    await tx.fraudAssessment.update({
      where: { id: a.id },
      data: {
        reviewStatus: status,
        reviewedBy: staffId,
        reviewedAt: new Date(),
        reviewNote: note?.trim().slice(0, 500) || null,
      },
    });
    await this.audit.record(
      {
        actorId: staffId,
        actorType: 'admin',
        action: `fraud.review.${status.toLowerCase()}`,
        entityType: 'order',
        entityId: a.orderId!,
        before: { reviewStatus: a.reviewStatus, score: a.score },
        after: { reviewStatus: status, note: note ?? null },
      },
      tx,
    );
  }

  private async view(id: string): Promise<FraudAssessmentView> {
    const row = await this.prisma.fraudAssessment.findUniqueOrThrow({ where: { id } });
    return (await this.views([row]))[0];
  }

  private async views(rows: FraudAssessment[]): Promise<FraudAssessmentView[]> {
    const ids = rows.map((r) => r.orderId).filter((x): x is string => !!x);
    const orders = await this.prisma.order.findMany({
      where: { id: { in: ids } },
      select: { id: true, number: true, status: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));
    return rows.map((r) => {
      const o = r.orderId ? byId.get(r.orderId) : undefined;
      return {
        id: r.id,
        orderId: r.orderId,
        orderNumber: o?.number ?? null,
        orderStatus: o?.status ?? null,
        userId: r.userId,
        score: r.score,
        decision: r.decision as FraudAssessmentView['decision'],
        signals: r.signals as unknown as FraudAssessmentView['signals'],
        paymentMethod: r.paymentMethod,
        totalPaise: Number(r.totalPaise),
        ip: r.ip,
        deviceId: r.deviceId,
        reviewStatus: r.reviewStatus as FraudAssessmentView['reviewStatus'],
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewNote: r.reviewNote,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
