import type { OrderStatus } from '@shopsphere/types';

/** Allowed transitions (M4.27, PRD §10). Anything else is a bug and is refused. */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  // Late capture (M4.34): confirm if stock can be re-reserved, else cancel and refund.
  PAYMENT_FAILED: ['CONFIRMED', 'CANCELLED_NO_STOCK'],
  CONFIRMED: ['PACKED', 'CANCELLED'],
  PACKED: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['RETURN_REQUESTED'],
  RETURN_REQUESTED: ['PICKED_UP', 'DELIVERED'],
  // Replace returns (M6.1) end in REPLACED once the item passes QC; the replacement is its own order.
  PICKED_UP: ['REFUNDED', 'REPLACED'],
  CANCELLED: [],
  CANCELLED_NO_STOCK: [],
  REFUNDED: [],
  REPLACED: [],
};

export const ORDER_STATUSES = Object.keys(TRANSITIONS) as OrderStatus[];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Customer cancel is allowed until the order ships (M4.29). */
export const CANCELLABLE: readonly OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];

/** Statuses the payment module treats as "money may still arrive and be kept". */
export function payableStatus(
  status: OrderStatus,
): 'PENDING_PAYMENT' | 'PAYMENT_FAILED' | 'CONFIRMED' | 'CANCELLED' {
  if (status === 'PENDING_PAYMENT' || status === 'PAYMENT_FAILED') return status;
  if (status === 'CANCELLED' || status === 'CANCELLED_NO_STOCK') return 'CANCELLED';
  return 'CONFIRMED';
}

/** Outbox event type for a transition (see OrderEventPayloads in @shopsphere/types). */
export function eventTypeFor(to: OrderStatus): string {
  switch (to) {
    case 'CONFIRMED':
      return 'order.confirmed';
    case 'PAYMENT_FAILED':
      return 'order.payment_expired';
    case 'CANCELLED':
    case 'CANCELLED_NO_STOCK':
      return 'order.cancelled';
    case 'SHIPPED':
      return 'order.shipped';
    case 'OUT_FOR_DELIVERY':
      return 'order.out_for_delivery';
    case 'DELIVERED':
      return 'order.delivered';
    default:
      return 'order.status_changed';
  }
}
