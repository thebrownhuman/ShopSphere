import { randomUUID } from 'node:crypto';
import type { OutboxEventInput } from '../../shared/outbox/outbox.service';
import type { PaymentStatus, RefundStatus } from '../domain/payment.types';
import type {
  AttemptRecord,
  NewAttempt,
  NewRefund,
  PaymentRecord,
  PaymentRepository,
  PaymentTx,
  RefundRecord,
} from '../repository/payment.repository';

interface State {
  payments: PaymentRecord[];
  attempts: AttemptRecord[];
  captures: Map<string, string>;
  webhookEvents: Map<string, { eventType: string; outcome?: string }>;
  refunds: RefundRecord[];
  outbox: OutboxEventInput[];
}

const uniqueViolation = () => Object.assign(new Error('unique violation'), { code: 'P2002' });

/**
 * Test double with the same unique constraints and all-or-nothing transactions as the
 * Prisma repository (state is snapshotted and restored if the callback throws).
 */
export class InMemoryPaymentRepository implements PaymentRepository {
  state: State = {
    payments: [],
    attempts: [],
    captures: new Map(),
    webhookEvents: new Map(),
    refunds: [],
    outbox: [],
  };

  async transaction<T>(fn: (tx: PaymentTx) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await fn(this.tx());
    } catch (err) {
      this.state = snapshot;
      throw err;
    }
  }

  private tx(): PaymentTx {
    const s = () => this.state;
    return {
      lockOrder: async () => undefined,
      findPaymentByProviderOrder: async (provider, providerOrderId) =>
        s().payments.find(
          (p) => p.provider === provider && p.providerOrderId === providerOrderId,
        ) ?? null,
      updatePaymentStatus: (id, status) => this.updatePaymentStatus(id, status),
      findAttempt: async (provider, providerPaymentId) =>
        s().attempts.find(
          (a) => a.provider === provider && a.providerPaymentId === providerPaymentId,
        ) ?? null,
      createAttempt: async (data: NewAttempt) => {
        if (
          s().attempts.some(
            (a) => a.provider === data.provider && a.providerPaymentId === data.providerPaymentId,
          )
        ) {
          throw uniqueViolation();
        }
        const row = { ...data, id: randomUUID() };
        s().attempts.push(row);
        return { ...row };
      },
      updateAttempt: async (id, data) => {
        Object.assign(s().attempts.find((a) => a.id === id)!, data);
      },
      claimOrderCapture: async (orderId, attemptId) => {
        if (s().captures.has(orderId)) return false;
        s().captures.set(orderId, attemptId);
        return true;
      },
      getOrderCapture: async (orderId) => s().captures.get(orderId) ?? null,
      recordWebhookEvent: async (provider, eventId, eventType) => {
        const key = `${provider}:${eventId}`;
        if (s().webhookEvents.has(key)) return false;
        s().webhookEvents.set(key, { eventType });
        return true;
      },
      setWebhookOutcome: async (provider, eventId, outcome) => {
        s().webhookEvents.get(`${provider}:${eventId}`)!.outcome = outcome;
      },
      createRefund: async (data: NewRefund) => {
        const row: RefundRecord = {
          ...data,
          id: randomUUID(),
          providerRefundId: null,
          status: 'PENDING',
        };
        s().refunds.push(row);
        return { ...row };
      },
      refundedAmount: async (attemptId) =>
        s()
          .refunds.filter((r) => r.attemptId === attemptId && r.status !== 'FAILED')
          .reduce((sum, r) => sum + r.amount, 0n),
      updateRefundByProviderId: async (providerRefundId, status) => {
        const row = s().refunds.find((r) => r.providerRefundId === providerRefundId);
        if (row) row.status = status;
        return Boolean(row);
      },
      enqueueOutbox: async (event) => {
        s().outbox.push(event);
      },
    };
  }

  async createPayment(data: Omit<PaymentRecord, 'id' | 'createdAt'>) {
    if (
      this.state.payments.some(
        (p) => p.provider === data.provider && p.providerOrderId === data.providerOrderId,
      )
    ) {
      throw uniqueViolation();
    }
    const row = { ...data, id: randomUUID(), createdAt: new Date() };
    this.state.payments.push(row);
    return { ...row };
  }

  async listPaymentsByOrder(orderId: string) {
    return this.state.payments.filter((p) => p.orderId === orderId).map((p) => ({ ...p }));
  }

  async listAttemptsByOrder(orderId: string) {
    return this.state.attempts.filter((a) => a.orderId === orderId).map((a) => ({ ...a }));
  }

  async findAttemptById(id: string) {
    const row = this.state.attempts.find((a) => a.id === id);
    return row ? { ...row } : null;
  }

  async getOrderCapture(orderId: string) {
    return this.state.captures.get(orderId) ?? null;
  }

  async listOpenPayments(createdAfter: Date) {
    return this.state.payments.filter(
      (p) => ['CREATED', 'PENDING', 'FAILED'].includes(p.status) && p.createdAt > createdAfter,
    );
  }

  async expireStalePayments(createdBefore: Date) {
    const stale = this.state.payments.filter(
      (p) => ['CREATED', 'PENDING'].includes(p.status) && p.createdAt <= createdBefore,
    );
    stale.forEach((p) => (p.status = 'EXPIRED'));
    return stale.length;
  }

  async updatePaymentStatus(id: string, status: PaymentStatus) {
    this.state.payments.find((p) => p.id === id)!.status = status;
  }

  async findRefund(id: string) {
    const row = this.state.refunds.find((r) => r.id === id);
    return row ? { ...row } : null;
  }

  async listRefundsByStatus(status: RefundStatus) {
    return this.state.refunds.filter((r) => r.status === status).map((r) => ({ ...r }));
  }

  async listRefundsByOrder(orderId: string) {
    return this.state.refunds.filter((r) => r.orderId === orderId).map((r) => ({ ...r }));
  }

  async updateRefund(
    id: string,
    data: { status: RefundStatus; providerRefundId?: string; lastError?: string | null },
  ) {
    const row = this.state.refunds.find((r) => r.id === id)!;
    row.status = data.status;
    if (data.providerRefundId) row.providerRefundId = data.providerRefundId;
  }
}
