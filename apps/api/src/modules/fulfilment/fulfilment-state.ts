import type { CourierTrackingStatus, OrderStatus, ShipmentStatus } from '@shopsphere/types';
import { canTransition } from '../order/order-state';

/** Shipment progress order. CANCELLED sits outside it. */
export const SHIPMENT_RANK: Record<ShipmentStatus, number> = {
  PENDING: 0,
  CONFIRMED: 1,
  ACCEPTED: 2,
  PACKED: 3,
  LABEL_CREATED: 4,
  SHIPPED: 5,
  OUT_FOR_DELIVERY: 6,
  DELIVERED: 7,
  CANCELLED: -1,
};

/**
 * Should a courier tracking event move the shipment? Couriers retry and reorder webhooks, so:
 * only forward moves apply (an OUT_FOR_DELIVERY arriving after DELIVERED is recorded but ignored),
 * skips are fine (DELIVERED straight after SHIPPED), and nothing applies before a label exists.
 */
export function trackingApplies(current: ShipmentStatus, event: CourierTrackingStatus): boolean {
  if (current === 'CANCELLED') return false;
  if (SHIPMENT_RANK[current] < SHIPMENT_RANK.LABEL_CREATED) return false;
  return SHIPMENT_RANK[event] > SHIPMENT_RANK[current];
}

/** The order follows its slowest live shipment. Null = nothing to move yet. */
export function orderTargetFor(shipments: ShipmentStatus[]): OrderStatus | null {
  const live = shipments.filter((s) => s !== 'CANCELLED');
  if (live.length === 0) return null;
  const min = Math.min(...live.map((s) => SHIPMENT_RANK[s]));
  if (min >= SHIPMENT_RANK.DELIVERED) return 'DELIVERED';
  if (min >= SHIPMENT_RANK.OUT_FOR_DELIVERY) return 'OUT_FOR_DELIVERY';
  if (min >= SHIPMENT_RANK.SHIPPED) return 'SHIPPED';
  if (min >= SHIPMENT_RANK.PACKED) return 'PACKED';
  return null;
}

const FORWARD: OrderStatus[] = ['CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/**
 * Order transitions needed to reach `target`, each allowed by the M4 state machine. Jumps
 * straight to the target when the machine allows it (SHIPPED → DELIVERED) so no event is
 * emitted for a step that never happened. Empty when already there, past it, or off the
 * forward path (cancelled, returns).
 */
export function orderPath(from: OrderStatus, target: OrderStatus): OrderStatus[] {
  const i = FORWARD.indexOf(from);
  const j = FORWARD.indexOf(target);
  if (i < 0 || j <= i) return [];
  const path: OrderStatus[] = [];
  let cur = from;
  while (cur !== target) {
    const next = canTransition(cur, target) ? target : FORWARD[FORWARD.indexOf(cur) + 1];
    if (!canTransition(cur, next)) return path;
    path.push(next);
    cur = next;
  }
  return path;
}
