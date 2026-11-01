/**
 * Returns (M6.1), help centre + support tickets (M6.8), web push (M6.9). Money is integer paise.
 *
 * Shopper:
 *   GET  /orders/:id/return            -> ReturnInfo (eligibility + current return, if any)
 *   POST /orders/:id/return            CreateReturnRequest -> ReturnView
 * Seller (approved seller account):
 *   GET  /seller/returns?status=       -> { items: SellerReturn[] }
 *   POST /seller/returns/:id/pickup    -> SellerReturn  (re-book a pickup the courier refused)
 *   POST /seller/returns/:id/qc        QcRequest -> SellerReturn (PASS refunds immediately)
 * Courier webhooks for return pickups share POST /shipping/webhooks/:provider.
 */

import type { Paise } from './index';
import type { OrderStatus } from './order';

export type ReturnReason =
  | 'DAMAGED'
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'NOT_AS_DESCRIBED'
  | 'SIZE_FIT'
  | 'NO_LONGER_NEEDED';

export const RETURN_REASONS: { code: ReturnReason; label: string }[] = [
  { code: 'DAMAGED', label: 'Item arrived damaged' },
  { code: 'DEFECTIVE', label: 'Item is defective or does not work' },
  { code: 'WRONG_ITEM', label: 'Received a different item' },
  { code: 'NOT_AS_DESCRIBED', label: 'Item not as described' },
  { code: 'SIZE_FIT', label: 'Size or fit issue' },
  { code: 'NO_LONGER_NEEDED', label: 'No longer needed' },
];

/** ORIGINAL: back to the payment method (5–7 working days). STORE_BALANCE: instant ShopSphere Pay. */
export type RefundTarget = 'ORIGINAL' | 'STORE_BALANCE';

/** REFUND: money back. REPLACE: same SKU re-shipped as a zero-value order (eligible categories). */
export type ReturnResolution = 'REFUND' | 'REPLACE';

export type ReturnStatus =
  | 'REQUESTED'
  | 'PICKUP_SCHEDULED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'RECEIVED'
  | 'QC_FAILED'
  | 'REFUNDED'
  /** Replace returns: item received and passed QC; the replacement order ships independently. */
  | 'REPLACED';

export interface ReturnView {
  id: string;
  orderId: string;
  status: ReturnStatus;
  reason: ReturnReason;
  comment: string | null;
  refundTo: RefundTarget;
  amountPaise: Paise;
  pickupDate: string;
  awb: string | null;
  qcNote: string | null;
  createdAt: string;
  pickedUpAt: string | null;
  receivedAt: string | null;
  refundedAt: string | null;
  resolution?: ReturnResolution;
  replacementOrderId?: string | null;
}

export interface ReturnInfo {
  orderId: string;
  orderStatus: OrderStatus;
  eligible: boolean;
  /** Why not, when not eligible. */
  reason: string | null;
  /** Last day (ISO) a return may be requested. */
  windowEndsAt: string | null;
  windowDays: number | null;
  /** Pickup days the shopper may choose (YYYY-MM-DD, IST). */
  pickupDates: string[];
  /** ORIGINAL is not offered for COD orders (nothing to refund to). */
  refundTargets: RefundTarget[];
  refundPaise: Paise;
  current: ReturnView | null;
  /** Whether "Replace" is offered (category allows it and stock is available). */
  replaceable?: boolean;
}

export interface CreateReturnRequest {
  reason: ReturnReason;
  comment?: string;
  refundTo: RefundTarget;
  pickupDate: string;
  /** Default REFUND. REPLACE ignores refundTo. */
  resolution?: ReturnResolution;
}

export interface SellerReturn extends ReturnView {
  orderNumber: string;
  /** Replace returns: the zero-value order shipping the replacement. */
  replacementOrderNumber?: string | null;
  items: { title: string; variant: string | null; qty: number }[];
  pickupFrom: { city: string; pincode: string };
}

export interface QcRequest {
  result: 'PASS' | 'FAIL';
  note?: string;
}

// ───────── Help centre + support (M6.8) ─────────

export type TicketCategory = 'ORDER' | 'RETURN' | 'PAYMENT' | 'ACCOUNT' | 'OTHER';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

export interface HelpArticle {
  slug: string;
  topic: string;
  title: string;
  summary: string;
  /** Paragraphs of plain text. */
  body: string[];
}

export interface CreateTicketRequest {
  category: TicketCategory;
  orderId?: string;
  subject: string;
  message: string;
}

export interface SupportTicket {
  id: string;
  number: string;
  category: TicketCategory;
  orderId: string | null;
  orderNumber: string | null;
  subject: string;
  message: string;
  status: TicketStatus;
  createdAt: string;
}

// ───────── Web push (M6.9) ─────────

/** GET /notifications/push/key */
export interface PushPublicKey {
  publicKey: string | null;
}

/** POST /notifications/push/subscriptions (PushSubscription.toJSON()); DELETE with { endpoint }. */
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
