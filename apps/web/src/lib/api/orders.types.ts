import type { CheckoutAddress, PaymentMethod, PriceBreakdown } from './checkout.types';

/** Web view types for "Your Orders" (M4.28). Money in paise, timestamps ISO 8601 UTC. */

/** PRD §10 lifecycle. */
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_FAILED'
  | 'CONFIRMED'
  | 'PACKED'
  | 'SHIPPED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'CANCELLED_NO_STOCK'
  | 'RETURN_REQUESTED'
  | 'PICKED_UP'
  | 'REFUNDED';

export interface OrderItem {
  skuId: string;
  slug: string;
  title: string;
  variant: Record<string, string>;
  image: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface TrackingEvent {
  status: OrderStatus;
  at: string;
  note: string | null;
}

export interface OrderShipment {
  id: string;
  sellerName: string;
  status: OrderStatus;
  items: OrderItem[];
  /** YYYY-MM-DD (IST) promised / actual delivery date. */
  deliveryDate: string | null;
  trackingId: string | null;
  tracking: TrackingEvent[];
  /** Signed download link to the GST invoice PDF once generated. */
  invoiceUrl: string | null;
}

export interface OrderSummary {
  id: string;
  number: string;
  placedAt: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  items: Pick<OrderItem, 'title' | 'image' | 'slug'>[];
  deliveryDate: string | null;
}

export interface OrderDetail extends Omit<OrderSummary, 'items'> {
  paymentMethod: PaymentMethod;
  address: CheckoutAddress;
  price: PriceBreakdown;
  shipments: OrderShipment[];
  /** Allowed until SHIPPED (PRD §10). */
  cancellable: boolean;
}

export interface OrdersQuery {
  year?: number;
  status?: 'ALL' | 'ACTIVE' | 'DELIVERED' | 'CANCELLED';
  page?: number;
}

export interface OrdersPage {
  orders: OrderSummary[];
  years: number[];
  total: number;
  page: number;
  pageSize: number;
}
