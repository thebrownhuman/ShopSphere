import type { ReturnStatus } from '@shopsphere/types';

/**
 * Return windows (M6.1) by top-level category slug, in days from delivery. 0 = not returnable
 * (grocery, hygiene). Unknown categories get DEFAULT_WINDOW_DAYS.
 */
export const RETURN_WINDOW_DAYS: Record<string, number> = {
  electronics: 7,
  mobiles: 7,
  fashion: 10,
  home: 10,
  books: 7,
  grocery: 0,
  beauty: 0,
};
export const DEFAULT_WINDOW_DAYS = 10;
const DAY_MS = 86_400_000;

export function windowDaysFor(rootSlug: string | null): number {
  if (!rootSlug) return DEFAULT_WINDOW_DAYS;
  return RETURN_WINDOW_DAYS[rootSlug] ?? DEFAULT_WINDOW_DAYS;
}

export type Eligibility =
  | { eligible: true; windowDays: number; windowEndsAt: Date }
  | { eligible: false; reason: string; windowDays: number | null; windowEndsAt: Date | null };

/**
 * An order is returnable when it is DELIVERED and within the shortest window of its items
 * (one non-returnable item makes the order non-returnable: returns are order level).
 */
export function checkEligibility(input: {
  orderStatus: string;
  deliveredAt: Date | null;
  itemRootSlugs: (string | null)[];
  now?: Date;
}): Eligibility {
  const now = input.now ?? new Date();
  const windowDays = input.itemRootSlugs.length
    ? Math.min(...input.itemRootSlugs.map(windowDaysFor))
    : DEFAULT_WINDOW_DAYS;
  if (input.orderStatus !== 'DELIVERED' || !input.deliveredAt) {
    return {
      eligible: false,
      reason: 'Only delivered orders can be returned',
      windowDays,
      windowEndsAt: null,
    };
  }
  if (windowDays === 0) {
    return {
      eligible: false,
      reason: 'Items in this order are not returnable',
      windowDays,
      windowEndsAt: null,
    };
  }
  const windowEndsAt = new Date(input.deliveredAt.getTime() + windowDays * DAY_MS);
  if (now > windowEndsAt) {
    return { eligible: false, reason: 'The return window has closed', windowDays, windowEndsAt };
  }
  return { eligible: true, windowDays, windowEndsAt };
}

/** Next `n` pickup days (IST, YYYY-MM-DD), starting tomorrow. */
export function pickupDates(now = new Date(), n = 3): string[] {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return Array.from({ length: n }, (_, i) =>
    new Date(ist.getTime() + (i + 1) * DAY_MS).toISOString().slice(0, 10),
  );
}

/** Courier status of a reverse pickup → return status. */
/**
 * Top-level categories where "Replace" (same SKU, zero-value order) is offered instead of a
 * refund. Consumables and media are refund-only.
 */
export const REPLACEABLE_ROOTS = new Set([
  'electronics',
  'mobiles-tablets',
  'appliances',
  'fashion',
]);

/** Replace is offered when every item's top-level category allows it. */
export function replaceAllowed(itemRootSlugs: (string | null)[]): boolean {
  return itemRootSlugs.length > 0 && itemRootSlugs.every((s) => !!s && REPLACEABLE_ROOTS.has(s));
}

export const COURIER_TO_RETURN: Record<string, ReturnStatus> = {
  SHIPPED: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'IN_TRANSIT',
  DELIVERED: 'RECEIVED',
};

const RANK: Record<ReturnStatus, number> = {
  REQUESTED: 0,
  PICKUP_SCHEDULED: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
  RECEIVED: 4,
  QC_FAILED: 5,
  REFUNDED: 5,
  REPLACED: 5,
};

/** Couriers retry and reorder webhooks: only forward moves apply. */
export function returnTrackingApplies(current: ReturnStatus, next: ReturnStatus): boolean {
  return RANK[next] > RANK[current] && RANK[current] < RANK.RECEIVED;
}
