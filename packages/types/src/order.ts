/**
 * Orders API contract (M4.27–M4.29) and the outbox events orders emit. Money is integer paise.
 * Keep changes additive.
 *
 *   GET  /orders?year=&status=&cursor=&limit=   -> OrdersPage
 *   GET  /orders/:id                            -> OrderDetail
 *   GET  /orders/:id/status                     -> OrderStatusResponse   (poll every 3 s)
 *   GET  /orders/:id/shipments/:shipmentId/invoice -> OrderInvoiceLink   (signed URL, ~5 min)
 *   POST /orders/:id/cancel   CancelOrderRequest -> OrderDetail          (allowed until SHIPPED)
 *
 * All routes need `Authorization: Bearer <access token>`; other users' orders answer 404.
 */

import type { CheckoutAddress, DeliveryOptionType, LineTax, PaymentProviderName } from './checkout';
import type { Paise } from './index';

/**
 * Lifecycle (PRD §10). Allowed transitions are enforced in the API (order-state.ts):
 *   PENDING_PAYMENT  -> CONFIRMED | PAYMENT_FAILED | CANCELLED
 *   PAYMENT_FAILED   -> CONFIRMED (late capture, stock re-reserved) | CANCELLED_NO_STOCK
 *   CONFIRMED        -> PACKED | CANCELLED
 *   PACKED           -> SHIPPED | CANCELLED
 *   SHIPPED          -> OUT_FOR_DELIVERY | DELIVERED
 *   OUT_FOR_DELIVERY -> DELIVERED
 *   DELIVERED        -> RETURN_REQUESTED
 *   RETURN_REQUESTED -> PICKED_UP | DELIVERED (return rejected)
 *   PICKED_UP        -> REFUNDED
 * PAYMENT_FAILED = the 15/30-minute payment window closed unpaid; stock was released.
 * A failed attempt inside the window keeps the order PENDING_PAYMENT (retry with another method).
 */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'CANCELLED_NO_STOCK'
  | 'PAYMENT_FAILED'
  | 'RETURN_REQUESTED'
  | 'PICKED_UP'
  | 'REFUNDED'
  /** Return resolved with a zero-value replacement order (M6.1 "Replace"). */
  | 'REPLACED';

export type OrderPaymentMethod = 'ONLINE' | 'COD' | 'STORE_BALANCE';

/** Aggregated payment view for polling (`/checkout/result`, "Payment pending" page). */
export type OrderPaymentState =
  | 'UNPAID'
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'COD'
  | 'NOT_REQUIRED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export interface OrderTotals {
  itemsPaise: Paise;
  mrpPaise: Paise;
  deliveryPaise: Paise;
  couponDiscountPaise: Paise;
  codFeePaise: Paise;
  totalPaise: Paise;
  storeBalancePaise: Paise;
  payablePaise: Paise;
  tax: { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; totalPaise: Paise };
}

export interface OrderItem {
  id: string;
  productId: string;
  skuId: string;
  sellerId: string;
  slug: string;
  title: string;
  variant: string | null;
  imageUrl: string | null;
  qty: number;
  unitPricePaise: Paise;
  mrpPaise: Paise;
  lineTotalPaise: Paise;
  discountPaise: Paise;
  tax: LineTax;
  /** HSN code printed on the invoice. */
  hsnCode?: string | null;
}

/**
 * PENDING (unpaid) → CONFIRMED (paid) → ACCEPTED → PACKED → LABEL_CREATED by the seller (M5.5),
 * then SHIPPED → OUT_FOR_DELIVERY → DELIVERED by courier tracking (M5.6). CANCELLED with the order.
 */
export type ShipmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'ACCEPTED'
  | 'PACKED'
  | 'LABEL_CREATED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export interface OrderShipment {
  id: string;
  sellerId: string;
  sellerName: string;
  /** Seller's state; drives CGST+SGST vs IGST. Invoices are issued in the seller's name. */
  sellerState: string;
  fulfilledByShopSphere: boolean;
  deliveryOption: DeliveryOptionType;
  deliveryFeePaise: Paise;
  /** YYYY-MM-DD (IST). */
  promisedDate: string;
  status: ShipmentStatus;
  items: OrderItem[];
  /** Courier + AWB once a label is booked (M5.6). */
  courier?: string | null;
  awb?: string | null;
  deliveredAt?: string | null;
  /** True once the invoice can be downloaded via the invoice route. */
  invoiceAvailable?: boolean;
}

export interface OrderEvent {
  id: string;
  /** Null for the creating event. */
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  /** PLACED | CONFIRMED | PAYMENT_ATTEMPT_FAILED | PAYMENT_EXPIRED | CANCELLED | ... */
  type: string;
  note: string | null;
  /** customer | system | payment | admin */
  actor: string;
  createdAt: string;
  /** Shipping events (SHIPPED / OUT_FOR_DELIVERY / DELIVERED): carrier + AWB. */
  courier?: string | null;
  awb?: string | null;
}

export interface OrderRefund {
  id: string;
  /** GATEWAY (original method) | STORE_BALANCE (instant). */
  destination: 'GATEWAY' | 'STORE_BALANCE';
  amountPaise: Paise;
  reason: string;
  /** PENDING | SUBMITTED | PROCESSED | FAILED */
  status: string;
  createdAt: string;
}

export interface OrderSummary {
  id: string;
  /** Human-facing number, e.g. OD2610311234567890. */
  number: string;
  status: OrderStatus;
  placedAt: string;
  totalPaise: Paise;
  itemCount: number;
  /** Up to 3 items for the list row. */
  previews: {
    title: string;
    imageUrl: string | null;
    qty: number;
    slug?: string;
    /** Promised delivery day, YYYY-MM-DD (IST). */
    expectedDeliveryDate?: string | null;
    /** ISO time the line's shipment was delivered. */
    deliveredAt?: string | null;
  }[];
  paymentMethod: OrderPaymentMethod;
  /** Set on a zero-value replacement order: the order it replaces. */
  replacementOfId?: string | null;
}

export interface OrderDetail extends OrderSummary {
  address: CheckoutAddress;
  totals: OrderTotals;
  shipments: OrderShipment[];
  payment: {
    method: OrderPaymentMethod;
    state: OrderPaymentState;
    provider: PaymentProviderName | null;
    /** ISO time until which a failed online payment may be retried (PENDING_PAYMENT only). */
    retryUntil: string | null;
  };
  coupon: { code: string; discountPaise: Paise } | null;
  refunds: OrderRefund[];
  /** Tracking timeline, oldest first. */
  events: OrderEvent[];
  canCancel: boolean;
  cancelReason: string | null;
  /** Replacement links (M6.1): original order of a replacement, and the replacement of a return. */
  replacementOf?: { orderId: string; number: string } | null;
  replacedBy?: { orderId: string; number: string } | null;
}

export interface OrderInvoiceLink {
  number: string;
  /** Short-lived pre-signed URL to the PDF. */
  url: string;
  expiresAt: string;
}

export interface OrdersPage {
  items: OrderSummary[];
  nextCursor: string | null;
  /** Years (desc) in which the shopper placed orders, for the year filter. */
  years?: number[];
}

export interface OrderStatusResponse {
  orderId: string;
  status: OrderStatus;
  paymentState: OrderPaymentState;
  payablePaise: Paise;
  retryUntil: string | null;
  updatedAt: string;
  orderNumber?: string;
  /** Reason of the latest failed attempt while PENDING_PAYMENT / PAYMENT_FAILED. */
  failureReason?: string | null;
}

export interface CancelOrderRequest {
  reason?: string;
}

export type OrderErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_CANCELLABLE'
  | 'ORDER_TRANSITION_INVALID'
  | 'ORDER_NOT_PAYABLE'
  | 'ORDER_ALREADY_PAID'
  | 'INVOICE_NOT_READY';

// ───────── Outbox events (consumed by invoices, notifications, analytics) ─────────

/**
 * Written to `outbox_events` in the same transaction as the change, with
 * aggregate_type = 'order', aggregate_id = orderId, event_type = the `type` below and
 * payload = the matching interface. Consumers must be idempotent on outbox_events.id.
 *
 * Payment-side events (aggregate_type = 'payment': payment.captured, payment.failed,
 * payment.duplicate_captured, payment.refund_requested, ...) are emitted by the payment module.
 */
export type OrderEventType =
  | 'order.placed'
  | 'order.confirmed'
  | 'order.payment_failed'
  | 'order.payment_expired'
  | 'order.cancelled'
  | 'order.status_changed'
  | 'order.shipped'
  | 'order.out_for_delivery'
  | 'order.delivered'
  | 'order.refund_issued';

interface OrderEventBase {
  orderId: string;
  orderNumber: string;
  userId: string;
  status: OrderStatus;
  /** ISO 8601 UTC. */
  occurredAt: string;
}

/** Order created (PENDING_PAYMENT, or CONFIRMED right after for COD). */
export interface OrderPlacedPayload extends OrderEventBase {
  paymentMethod: OrderPaymentMethod;
  totalPaise: Paise;
  payablePaise: Paise;
  itemCount: number;
}

/**
 * Order confirmed: stock deducted, cart cleared, coupon usage recorded.
 * Invoice worker: one GST invoice per shipment (seller name + state). Notifications: "order placed".
 */
export interface OrderConfirmedPayload extends OrderEventBase {
  paymentMethod: OrderPaymentMethod;
  totalPaise: Paise;
  payablePaise: Paise;
  /** True when the capture arrived after the payment window (M4.34). */
  lateCapture: boolean;
  /** Buyer addresses (billing = shipping in this simulation). */
  billingAddress?: CheckoutAddress;
  shippingAddress?: CheckoutAddress;
  /** Set on a replacement order. */
  replacementOfId?: string | null;
  shipments: {
    shipmentId: string;
    sellerId: string;
    sellerName: string;
    sellerState: string;
    shipToState: string;
    promisedDate: string;
    sellerGstin?: string | null;
    /** Seller's registered / pickup address, one line. */
    sellerAddress?: string | null;
    deliveryFeePaise?: Paise;
    invoiceNumber?: string;
    /** Object key in the invoices bucket where the worker must write the PDF. */
    invoiceKey?: string;
    items: {
      orderItemId: string;
      skuId: string;
      title: string;
      qty: number;
      unitPricePaise: Paise;
      lineTotalPaise: Paise;
      discountPaise: Paise;
      tax: LineTax;
      hsnCode?: string | null;
    }[];
  }[];
}

/** One online attempt failed; order still PENDING_PAYMENT and retryable until retryUntil. */
export interface OrderPaymentFailedPayload extends OrderEventBase {
  reason: string | null;
  provider: PaymentProviderName;
  retryUntil: string;
}

/** Payment window closed unpaid: stock released, order PAYMENT_FAILED, cart kept. */
export interface OrderPaymentExpiredPayload extends OrderEventBase {
  payablePaise: Paise;
}

/**
 * Cancelled by the customer (CANCELLED) or because a late capture found no stock
 * (CANCELLED_NO_STOCK: send the apology email/SMS). Refunds are listed when money moved.
 */
export interface OrderCancelledPayload extends OrderEventBase {
  reason: string;
  /** customer | system */
  cancelledBy: string;
  refunds: { destination: 'GATEWAY' | 'STORE_BALANCE'; amountPaise: Paise }[];
}

/** Any other transition (PACKED, SHIPPED, ... from seller/courier flows). */
export interface OrderStatusChangedPayload extends OrderEventBase {
  fromStatus: OrderStatus;
}

/** Courier-driven transitions (M5.6). One event per order transition, not per shipment. */
export interface OrderShippingPayload extends OrderEventBase {
  fromStatus: OrderStatus;
  shipmentId: string;
  courier: string;
  awb: string;
}

export interface OrderRefundIssuedPayload extends OrderEventBase {
  destination: 'GATEWAY' | 'STORE_BALANCE';
  amountPaise: Paise;
  reason: string;
}

export interface OrderEventPayloads {
  'order.placed': OrderPlacedPayload;
  'order.confirmed': OrderConfirmedPayload;
  'order.payment_failed': OrderPaymentFailedPayload;
  'order.payment_expired': OrderPaymentExpiredPayload;
  'order.cancelled': OrderCancelledPayload;
  'order.status_changed': OrderStatusChangedPayload;
  'order.shipped': OrderShippingPayload;
  'order.out_for_delivery': OrderShippingPayload;
  'order.delivered': OrderShippingPayload;
  'order.refund_issued': OrderRefundIssuedPayload;
}
