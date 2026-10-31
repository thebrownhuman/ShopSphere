import type { CartPriceChange, CartStockChange, CartSummary } from '@shopsphere/types';
import { DELIVERY_FEE_PAISE } from '../delivery/delivery-estimate';

/**
 * Cart pricing engine (M3.4). Pure: the service feeds it live offer data, it returns what the
 * shopper may buy and what it costs. Clients never send prices; every total comes from here.
 */

export interface LiveOffer {
  price: number;
  mrp: number;
  /** stock - reserved. */
  available: number;
  maxPerOrder: number;
  /** Offer, seller and product all active. */
  active: boolean;
}

export interface PricingInput {
  qty: number;
  snapshotPrice: number;
  offer: LiveOffer | null;
  serviceable: boolean;
}

export interface PricedLine {
  unitPrice: number;
  mrp: number;
  maxQty: number;
  /** Units that count toward totals: 0 when unbuyable or undeliverable. */
  purchasableQty: number;
  lineTotal: number;
  inStock: boolean;
  available: number;
  priceChange: CartPriceChange | null;
  stockChange: CartStockChange | null;
}

export interface PricingLimits {
  maxQtyPerItem: number;
  freeDeliveryThreshold: number;
}

/** Highest qty allowed for one line right now. */
export function lineCap(offer: LiveOffer | null, maxQtyPerItem: number): number {
  if (!offer || !offer.active) return 0;
  return Math.max(0, Math.min(offer.available, offer.maxPerOrder, maxQtyPerItem));
}

export function priceLine(input: PricingInput, limits: PricingLimits): PricedLine {
  const { offer } = input;
  const live = offer?.active ? offer : null;
  const maxQty = lineCap(offer, limits.maxQtyPerItem);
  let stockChange: CartStockChange | null = null;
  if (!live) stockChange = 'UNAVAILABLE';
  else if (live.available <= 0) stockChange = 'OUT_OF_STOCK';
  else if (input.qty > maxQty) stockChange = 'LIMITED';
  const unitPrice = live?.price ?? 0;
  const purchasableQty = input.serviceable ? Math.min(input.qty, maxQty) : 0;
  return {
    unitPrice,
    mrp: live ? Math.max(live.mrp, live.price) : 0,
    maxQty,
    purchasableQty,
    lineTotal: unitPrice * purchasableQty,
    inStock: maxQty > 0,
    available: live ? Math.max(0, live.available) : 0,
    priceChange:
      live && live.price !== input.snapshotPrice
        ? { from: input.snapshotPrice, to: live.price }
        : null,
    stockChange,
  };
}

export function summarise(
  lines: { priced: PricedLine; serviceable: boolean }[],
  limits: PricingLimits,
): CartSummary {
  let itemCount = 0;
  let subtotal = 0;
  let mrpTotal = 0;
  let hasIssues = false;
  for (const { priced, serviceable } of lines) {
    itemCount += priced.purchasableQty;
    subtotal += priced.lineTotal;
    mrpTotal += priced.mrp * priced.purchasableQty;
    if (priced.stockChange || !serviceable) hasIssues = true;
  }
  const freeDeliveryEligible = subtotal >= limits.freeDeliveryThreshold;
  const deliveryFee = subtotal === 0 || freeDeliveryEligible ? 0 : DELIVERY_FEE_PAISE;
  return {
    itemCount,
    lineCount: lines.length,
    subtotal,
    mrpTotal,
    savings: mrpTotal - subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    freeDeliveryThreshold: limits.freeDeliveryThreshold,
    freeDeliveryRemaining: freeDeliveryEligible ? 0 : limits.freeDeliveryThreshold - subtotal,
    freeDeliveryEligible,
    hasIssues,
  };
}

// ───────── Guest → user merge (M3.5) ─────────

export interface MergeLine {
  skuId: string;
  sellerId: string;
  qty: number;
}

export interface MergePlan {
  updates: { id: string; qty: number }[];
  inserts: MergeLine[];
  /** Guest lines that did not fit under the line limit. */
  dropped: MergeLine[];
}

const lineKey = (l: { skuId: string; sellerId: string }) => `${l.skuId}:${l.sellerId}`;

/**
 * Same SKU + seller in both carts: quantities are summed and capped at the live limit, but the
 * user's own quantity is never reduced. New lines are added (capped) until the line limit; the
 * rest are dropped. `capFor` returns 0 for unbuyable offers: such lines are kept (capped at
 * maxQtyPerItem) so the cart shows them as unavailable instead of silently losing them.
 */
export function planMerge(
  user: (MergeLine & { id: string })[],
  guest: MergeLine[],
  capFor: (l: MergeLine) => number,
  limits: { maxLines: number; maxQtyPerItem: number },
): MergePlan {
  const byKey = new Map(user.map((l) => [lineKey(l), l]));
  const plan: MergePlan = { updates: [], inserts: [], dropped: [] };
  let lines = user.length;
  for (const g of guest) {
    const cap = capFor(g) || limits.maxQtyPerItem;
    const mine = byKey.get(lineKey(g));
    if (mine) {
      const qty = Math.max(mine.qty, Math.min(mine.qty + g.qty, cap));
      if (qty !== mine.qty) plan.updates.push({ id: mine.id, qty });
    } else if (lines < limits.maxLines) {
      plan.inserts.push({ ...g, qty: Math.max(1, Math.min(g.qty, cap)) });
      lines += 1;
    } else {
      plan.dropped.push(g);
    }
  }
  return plan;
}
