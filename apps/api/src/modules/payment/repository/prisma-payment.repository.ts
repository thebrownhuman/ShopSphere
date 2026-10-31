import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { PrismaService, Tx } from '../../shared/prisma/prisma.service';
import type { PaymentStatus, RefundStatus } from '../domain/payment.types';
import { OPEN_PAYMENT_STATUSES } from '../domain/payment.types';
import type {
  AttemptRecord,
  PaymentRecord,
  PaymentRepository,
  PaymentTx,
  RefundRecord,
} from './payment.repository';

const asPayment = (row: unknown) => row as PaymentRecord;
const asAttempt = (row: unknown) => row as AttemptRecord;
const asRefund = (row: unknown) => row as RefundRecord;

class PrismaPaymentTx implements PaymentTx {
  constructor(
    private readonly tx: Tx,
    private readonly outbox: OutboxService,
  ) {}

  async lockOrder(orderId: string): Promise<void> {
    await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payment:' + orderId}))`;
  }

  async findPaymentByProviderOrder(provider: string, providerOrderId: string) {
    const row = await this.tx.payment.findUnique({
      where: { provider_providerOrderId: { provider, providerOrderId } },
    });
    return row ? asPayment(row) : null;
  }

  async updatePaymentStatus(id: string, status: PaymentStatus) {
    await this.tx.payment.update({ where: { id }, data: { status } });
  }

  async findAttempt(provider: string, providerPaymentId: string) {
    const row = await this.tx.paymentAttempt.findUnique({
      where: { provider_providerPaymentId: { provider, providerPaymentId } },
    });
    return row ? asAttempt(row) : null;
  }

  async createAttempt(data: Omit<AttemptRecord, 'id'>) {
    return asAttempt(await this.tx.paymentAttempt.create({ data }));
  }

  async updateAttempt(id: string, data: Partial<AttemptRecord>) {
    await this.tx.paymentAttempt.update({ where: { id }, data });
  }

  async claimOrderCapture(orderId: string, attemptId: string) {
    // ON CONFLICT DO NOTHING keeps the transaction usable when we lose the race.
    const { count } = await this.tx.orderPaymentCapture.createMany({
      data: [{ orderId, attemptId }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async getOrderCapture(orderId: string) {
    const row = await this.tx.orderPaymentCapture.findUnique({ where: { orderId } });
    return row?.attemptId ?? null;
  }

  async recordWebhookEvent(provider: string, eventId: string, eventType: string, payload: unknown) {
    const { count } = await this.tx.webhookEvent.createMany({
      data: [{ provider, eventId, eventType, payload: payload as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  async setWebhookOutcome(provider: string, eventId: string, outcome: string) {
    await this.tx.webhookEvent.update({
      where: { provider_eventId: { provider, eventId } },
      data: { outcome, processedAt: new Date() },
    });
  }

  async createRefund(data: Omit<RefundRecord, 'id' | 'providerRefundId' | 'status'>) {
    return asRefund(await this.tx.refund.create({ data: { ...data, status: 'PENDING' } }));
  }

  async refundedAmount(attemptId: string) {
    const agg = await this.tx.refund.aggregate({
      where: { attemptId, status: { not: 'FAILED' } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0n;
  }

  async updateRefundByProviderId(providerRefundId: string, status: RefundStatus) {
    const { count } = await this.tx.refund.updateMany({
      where: { providerRefundId },
      data: { status },
    });
    return count > 0;
  }

  async enqueueOutbox(event: Parameters<OutboxService['enqueue']>[1]) {
    await this.outbox.enqueue(this.tx, event);
  }
}

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  transaction<T>(fn: (tx: PaymentTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaPaymentTx(tx, this.outbox)));
  }

  async createPayment(data: Omit<PaymentRecord, 'id' | 'createdAt'>) {
    return asPayment(await this.prisma.payment.create({ data }));
  }

  async listPaymentsByOrder(orderId: string) {
    const rows = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(asPayment);
  }

  async listAttemptsByOrder(orderId: string) {
    const rows = await this.prisma.paymentAttempt.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(asAttempt);
  }

  async findAttemptById(id: string) {
    const row = await this.prisma.paymentAttempt.findUnique({ where: { id } });
    return row ? asAttempt(row) : null;
  }

  async getOrderCapture(orderId: string) {
    const row = await this.prisma.orderPaymentCapture.findUnique({ where: { orderId } });
    return row?.attemptId ?? null;
  }

  async listOpenPayments(createdAfter: Date) {
    const rows = await this.prisma.payment.findMany({
      where: { status: { in: OPEN_PAYMENT_STATUSES }, createdAt: { gt: createdAfter } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return rows.map(asPayment);
  }

  async expireStalePayments(createdBefore: Date) {
    const { count } = await this.prisma.payment.updateMany({
      where: { status: { in: ['CREATED', 'PENDING'] }, createdAt: { lte: createdBefore } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }

  async updatePaymentStatus(id: string, status: PaymentStatus) {
    await this.prisma.payment.update({ where: { id }, data: { status } });
  }

  async findRefund(id: string) {
    const row = await this.prisma.refund.findUnique({ where: { id } });
    return row ? asRefund(row) : null;
  }

  async listRefundsByStatus(status: RefundStatus) {
    const rows = await this.prisma.refund.findMany({ where: { status }, take: 500 });
    return rows.map(asRefund);
  }

  async listRefundsByOrder(orderId: string) {
    const rows = await this.prisma.refund.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(asRefund);
  }

  async updateRefund(
    id: string,
    data: { status: RefundStatus; providerRefundId?: string; lastError?: string | null },
  ) {
    await this.prisma.refund.update({ where: { id }, data });
  }
}
