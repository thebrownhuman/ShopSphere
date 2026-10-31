import type { OrderEventPayloads, OrderEventType } from '@shopsphere/types';

/**
 * Order outbox events as the worker feed delivers them. Payloads are the order module's
 * contract (OrderEventPayloads in packages/types/src/order.ts); `id` is outbox_events.id, the
 * idempotency key for every consumer.
 */
export type { OrderEventPayloads, OrderEventType };

export type OrderEventEnvelope<T extends OrderEventType = OrderEventType> = {
  [K in T]: { id: string; type: K; occurredAt: string; payload: OrderEventPayloads[K] };
}[T];

/** Types the workers act on: invoices (confirmed) and notifications (the rest too). */
export const ORDER_EVENT_TYPES: OrderEventType[] = [
  'order.confirmed',
  'order.payment_failed',
  'order.payment_expired',
  'order.status_changed',
  'order.cancelled',
];
