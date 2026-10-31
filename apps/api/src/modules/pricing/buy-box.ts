/** Input view of an offer for buy-box selection; all fields come from offers + sellers. */
export interface BuyBoxCandidate {
  id: string;
  price: bigint;
  stockQty: number;
  reservedQty: number;
  status: string;
  sellerStatus: string;
  /** 0–50 (rating x10). */
  sellerRatingX10: number;
  isFirstParty: boolean;
  /** Fastest delivery SLA in days from the seller's location. */
  slaDays: number;
}

export const BUY_BOX_WEIGHTS = { price: 0.6, rating: 0.25, speed: 0.15 } as const;

export function isBuyable(o: BuyBoxCandidate): boolean {
  return o.status === 'ACTIVE' && o.sellerStatus === 'ACTIVE' && o.stockQty - o.reservedQty > 0;
}

/**
 * Buy-box v1 (M2.5). Score in [0, 1] per eligible offer:
 * 0.60 × (cheapest / price) + 0.25 × (rating / 5) + 0.15 × (fastest SLA / SLA).
 * Ties go to first-party, then lower price, then id, so the result is deterministic.
 */
export function scoreOffers<T extends BuyBoxCandidate>(offers: T[]): { offer: T; score: number }[] {
  const live = offers.filter(isBuyable);
  if (live.length === 0) return [];
  const minPrice = live.reduce((m, o) => (o.price < m ? o.price : m), live[0].price);
  const minSla = Math.max(1, Math.min(...live.map((o) => o.slaDays)));
  return live
    .map((offer) => ({
      offer,
      score:
        BUY_BOX_WEIGHTS.price * (Number(minPrice) / Number(offer.price)) +
        BUY_BOX_WEIGHTS.rating * (offer.sellerRatingX10 / 50) +
        BUY_BOX_WEIGHTS.speed * (minSla / Math.max(1, offer.slaDays)),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.offer.isFirstParty) - Number(a.offer.isFirstParty) ||
        (a.offer.price < b.offer.price ? -1 : a.offer.price > b.offer.price ? 1 : 0) ||
        a.offer.id.localeCompare(b.offer.id),
    );
}

export function pickBuyBox<T extends BuyBoxCandidate>(offers: T[]): T | null {
  return scoreOffers(offers)[0]?.offer ?? null;
}
