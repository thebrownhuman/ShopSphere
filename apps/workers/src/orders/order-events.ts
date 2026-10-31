/**
 * Order outbox events consumed by the invoice and notification workers (M4.30, M4.31).
 *
 * MERGE NOTE: this is the payload shape these consumers expect. The order module writes the
 * events (OutboxService.enqueue, aggregateType "order") and owns packages/types/src/order.ts;
 * reconcile the two at merge and then import from @shopsphere/types here. The notification
 * module's templates read a subset of the same fields (apps/api/src/modules/notification).
 *
 * Money is integer paise (GST-inclusive selling prices), timestamps ISO 8601 UTC.
 */

export type OrderEventType =
  | 'order.confirmed'
  | 'payment.failed'
  | 'order.shipped'
  | 'order.delivered'
  | 'order.cancelled';

/** One row of outbox_events as the feed returns it. `id` is the idempotency key. */
export interface OrderEventEnvelope<T extends OrderEventType = OrderEventType> {
  id: string;
  type: T;
  occurredAt: string;
  payload: OrderEventPayloads[T];
}

export interface Recipient {
  userId: string;
  name: string;
  email: string | null;
  /** E.164, e.g. +919876543210. */
  phone: string | null;
}

export interface PostalAddress {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  /** GST state code, e.g. "29" for Karnataka; decides CGST+SGST vs IGST. */
  stateCode: string;
  pincode: string;
}

export interface EventItem {
  skuId: string;
  title: string;
  qty: number;
  /** GST-inclusive unit price. */
  unitPrice: number;
  /** HSN/SAC code printed on the invoice. */
  hsn: string;
  /** GST rate in percent: 0, 5, 12, 18 or 28. */
  gstRate: number;
}

/** Seller of record: invoices are issued in the seller's name (marketplace model). */
export interface EventSeller {
  id: string;
  legalName: string;
  gstin: string;
  address: PostalAddress;
}

export interface EventShipment {
  id: string;
  seller: EventSeller;
  items: EventItem[];
  /** Delivery fee charged for this shipment, GST-inclusive. */
  shippingFee: number;
  deliveryDate: string | null;
}

export interface OrderRef {
  orderId: string;
  orderNumber: string;
  recipient: Recipient;
}

export interface OrderConfirmedPayload extends OrderRef {
  placedAt: string;
  paymentMethod: 'BANK' | 'RAZORPAY' | 'COD' | 'GIFT_CARD';
  total: number;
  billingAddress: PostalAddress;
  shippingAddress: PostalAddress;
  shipments: EventShipment[];
}

export interface PaymentFailedPayload extends OrderRef {
  amount: number;
  reason: string | null;
  /** Retry allowed until (ISO), the 15-minute window. */
  retryUntil: string | null;
}

export interface OrderShippedPayload extends OrderRef {
  shipmentId: string;
  sellerName: string;
  trackingId: string | null;
  carrier: string | null;
  itemTitles: string[];
  deliveryDate: string | null;
}

export interface OrderDeliveredPayload extends OrderRef {
  shipmentId: string;
  itemTitles: string[];
  deliveredAt: string;
}

export interface OrderCancelledPayload extends OrderRef {
  reason: string | null;
  refundAmount: number;
}

export interface OrderEventPayloads {
  'order.confirmed': OrderConfirmedPayload;
  'payment.failed': PaymentFailedPayload;
  'order.shipped': OrderShippedPayload;
  'order.delivered': OrderDeliveredPayload;
  'order.cancelled': OrderCancelledPayload;
}

export const ORDER_EVENT_TYPES: OrderEventType[] = [
  'order.confirmed',
  'payment.failed',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
];
