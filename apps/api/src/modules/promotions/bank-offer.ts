/** Pure bank-offer maths (M6.6), kept apart from persistence so it is unit-testable. */
export interface BankOfferDef {
  id: string;
  title: string;
  provider: string;
  percentBp: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  startsAt: Date;
  endsAt: Date;
  active: boolean;
}

export interface BankOfferPick {
  id: string;
  title: string;
  discountPaise: number;
}

export type PaymentChoice = { type: 'ONLINE'; provider: string } | { type: 'COD' } | null;

/**
 * Best live offer for a payment. Only ONLINE payments through the offer's provider qualify
 * (ShopSphere Bank = provider "bank"); COD, Razorpay and store-balance payments never do.
 * `amountPaise` is the order value after coupon, before delivery / COD fees.
 */
export function pickBankOffer(
  offers: BankOfferDef[],
  payment: PaymentChoice,
  amountPaise: number,
  now: Date,
): BankOfferPick | null {
  if (!payment || payment.type !== 'ONLINE' || amountPaise <= 0) return null;
  let best: BankOfferPick | null = null;
  for (const o of offers) {
    if (!o.active || o.provider !== payment.provider) continue;
    if (now < o.startsAt || now >= o.endsAt || amountPaise < o.minOrderPaise) continue;
    let d = Math.floor((amountPaise * o.percentBp) / 10_000);
    if (o.maxDiscountPaise !== null) d = Math.min(d, o.maxDiscountPaise);
    d = Math.min(d, amountPaise);
    if (d > 0 && (!best || d > best.discountPaise))
      best = { id: o.id, title: o.title, discountPaise: d };
  }
  return best;
}
