import type { OutboxEventInput } from '../../shared/outbox/outbox.service';
import type {
  AttemptStatus,
  PaymentStatus,
  ProviderName,
  RefundReason,
  RefundStatus,
} from '../domain/payment.types';

export interface PaymentRecord {
  id: string;
  orderId: string;
  provider: ProviderName;
  providerOrderId: string;
  amount: bigint;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
}

export interface AttemptRecord {
  id: string;
  paymentId: string;
  orderId: string;
  provider: ProviderName;
  providerPaymentId: string;
  amount: bigint;
  currency: string;
  method: string | null;
  status: AttemptStatus;
  errorReason: string | null;
}

export interface RefundRecord {
  id: string;
  attemptId: string;
  orderId: string;
  provider: ProviderName;
  providerRefundId: string | null;
  amount: bigint;
  reason: RefundReason;
  status: RefundStatus;
}

export type NewAttempt = Omit<AttemptRecord, 'id'>;
export type NewRefund = Omit<RefundRecord, 'id' | 'providerRefundId' | 'status'>;

/** Writes that must commit atomically with one webhook / reconciliation event. */
export interface PaymentTx {
  /** Serialises all money-state changes for one shop order (pg advisory xact lock). */
  lockOrder(orderId: string): Promise<void>;
  findPaymentByProviderOrder(
    provider: string,
    providerOrderId: string,
  ): Promise<PaymentRecord | null>;
  updatePaymentStatus(id: string, status: PaymentStatus): Promise<void>;
  findAttempt(provider: string, providerPaymentId: string): Promise<AttemptRecord | null>;
  createAttempt(data: NewAttempt): Promise<AttemptRecord>;
  updateAttempt(
    id: string,
    data: Partial<Pick<AttemptRecord, 'status' | 'method' | 'errorReason'>>,
  ): Promise<void>;
  /** First-capture-wins: true if this attempt became the order's winning capture. */
  claimOrderCapture(orderId: string, attemptId: string): Promise<boolean>;
  getOrderCapture(orderId: string): Promise<string | null>;
  /** False if (provider, eventId) was already recorded. */
  recordWebhookEvent(
    provider: string,
    eventId: string,
    eventType: string,
    payload: unknown,
  ): Promise<boolean>;
  setWebhookOutcome(provider: string, eventId: string, outcome: string): Promise<void>;
  createRefund(data: NewRefund): Promise<RefundRecord>;
  /** Sum of refunds on an attempt that are not FAILED. */
  refundedAmount(attemptId: string): Promise<bigint>;
  updateRefundByProviderId(providerRefundId: string, status: RefundStatus): Promise<boolean>;
  enqueueOutbox(event: OutboxEventInput): Promise<void>;
}

export interface PaymentRepository {
  transaction<T>(fn: (tx: PaymentTx) => Promise<T>): Promise<T>;
  createPayment(data: Omit<PaymentRecord, 'id' | 'createdAt'>): Promise<PaymentRecord>;
  listPaymentsByOrder(orderId: string): Promise<PaymentRecord[]>;
  listAttemptsByOrder(orderId: string): Promise<AttemptRecord[]>;
  findAttemptById(id: string): Promise<AttemptRecord | null>;
  getOrderCapture(orderId: string): Promise<string | null>;
  /** Payments created after `createdAfter` that may still change at the gateway. */
  listOpenPayments(createdAfter: Date): Promise<PaymentRecord[]>;
  /** CREATED/PENDING payments older than `createdBefore` become EXPIRED; returns count. */
  expireStalePayments(createdBefore: Date): Promise<number>;
  updatePaymentStatus(id: string, status: PaymentStatus): Promise<void>;
  findRefund(id: string): Promise<RefundRecord | null>;
  listRefundsByStatus(status: RefundStatus): Promise<RefundRecord[]>;
  listRefundsByOrder(orderId: string): Promise<RefundRecord[]>;
  updateRefund(
    id: string,
    data: { status: RefundStatus; providerRefundId?: string; lastError?: string | null },
  ): Promise<void>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
