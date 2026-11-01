import type { TimelineStep } from '@shopsphere/ui';
import type { OrderStatus, TrackingEvent } from '@/lib/api/orders.types';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Payment pending',
  PAYMENT_FAILED: 'Payment failed',
  CONFIRMED: 'Order confirmed',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  CANCELLED_NO_STOCK: 'Cancelled (sold out)',
  RETURN_REQUESTED: 'Return requested',
  PICKED_UP: 'Picked up',
  REFUNDED: 'Refunded',
  REPLACED: 'Replaced',
};

const FORWARD: OrderStatus[] = ['CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const RETURN: OrderStatus[] = ['RETURN_REQUESTED', 'PICKED_UP', 'REFUNDED'];
const REPLACE: OrderStatus[] = ['RETURN_REQUESTED', 'PICKED_UP', 'REPLACED'];
const BRANCH: OrderStatus[] = [
  'CANCELLED',
  'CANCELLED_NO_STOCK',
  'PAYMENT_FAILED',
  'PENDING_PAYMENT',
];

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

const detail = (e: TrackingEvent | undefined) =>
  e ? [when(e.at), e.note].filter(Boolean).join(' · ') : undefined;

/**
 * Tracking timeline (M4.28): the forward path with reached steps filled in from the shipment's
 * events. A branch (cancelled, payment failed/pending) stops the path where it happened.
 */
export function timelineSteps(status: OrderStatus, events: TrackingEvent[]): TimelineStep[] {
  const at = new Map(events.map((e) => [e.status, e]));
  const branch = BRANCH.includes(status);
  const path =
    status === 'REPLACED' || at.has('REPLACED')
      ? [...FORWARD, ...REPLACE]
      : RETURN.includes(status)
        ? [...FORWARD, ...RETURN]
        : FORWARD;
  const reached = path.filter((s) => at.has(s));
  const last = reached.at(-1);
  const steps: TimelineStep[] = (branch ? reached : path).map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    detail: detail(at.get(s)),
    state: !at.has(s)
      ? 'upcoming'
      : s === last && s === status && s !== 'DELIVERED' && s !== 'REFUNDED' && s !== 'REPLACED'
        ? 'current'
        : 'done',
  }));
  if (branch) {
    steps.push({
      key: status,
      label: STATUS_LABEL[status],
      detail: detail(at.get(status)),
      state: status === 'PENDING_PAYMENT' ? 'current' : 'stopped',
    });
  }
  return steps;
}
