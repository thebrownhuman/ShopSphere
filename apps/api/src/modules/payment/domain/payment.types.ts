/** Gateways behind the PaymentProvider interface. */
export const PROVIDERS = ['razorpay', 'bank'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

/** payments.status: lifecycle of one gateway order. */
export type PaymentStatus = 'CREATED' | 'PENDING' | 'CAPTURED' | 'FAILED' | 'DUPLICATE' | 'EXPIRED';

/** payment_attempts.status: lifecycle of one gateway payment id. */
export type AttemptStatus =
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'DUPLICATE_CAPTURE'
  | 'AMOUNT_MISMATCH'
  | 'REFUND_ON_CAPTURE';

/** refunds.status. PENDING = not yet accepted by the gateway (retried by reconciliation). */
export type RefundStatus = 'PENDING' | 'SUBMITTED' | 'PROCESSED' | 'FAILED';

export type RefundReason =
  | 'DUPLICATE_CAPTURE'
  | 'AMOUNT_MISMATCH'
  | 'ORDER_CANCELLED'
  | 'PAYMENT_EXPIRED'
  | 'CUSTOMER_REQUEST';

/** Aggregate view returned by GET /payments/:orderId/status. */
export type OrderPaymentState = 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED';

/** Outcome stored on webhook_events.outcome; also what tests assert on. */
export type EventOutcome =
  | 'CAPTURED'
  | 'DUPLICATE_REFUNDED'
  | 'CAPTURED_REFUNDED'
  | 'AMOUNT_MISMATCH'
  | 'FAILED'
  | 'AUTHORIZED'
  | 'IGNORED_STALE'
  | 'ALREADY_APPLIED'
  | 'UNKNOWN_ORDER'
  | 'REFUND_UPDATED'
  | 'IGNORED_TYPE'
  | 'DUPLICATE_EVENT';

export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = ['CREATED', 'PENDING', 'FAILED'];
/** Retry window for another method on the same order (PRD section 9, step 7). */
export const RETRY_WINDOW_MS = 15 * 60 * 1000;
/** Reconciliation polls open payments for this long (M4.17). */
export const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
