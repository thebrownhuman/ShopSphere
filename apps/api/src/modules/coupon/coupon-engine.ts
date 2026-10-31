import type { CouponErrorCode } from '@shopsphere/types';

/**
 * Coupon engine v1 (M4.6). Pure: the caller loads the coupon, the user's prior redemptions and
 * the lines; this decides eligibility and the discount. Scope: a line is eligible when its
 * seller is in `sellerIds` (if any) and one of its category ancestors is in `categoryIds` (if any).
 * Min order applies to the eligible subtotal. The discount is spread over eligible lines in
 * proportion to their totals (remainder on the last), which is what GST is computed on.
 */

export interface CouponDef {
  code: string;
  description: string;
  type: 'FLAT' | 'PERCENT';
  /** Paise (FLAT) or basis points (PERCENT). */
  value: number;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  perUserLimit: number;
  totalLimit: number | null;
  usedCount: number;
  categoryIds: string[];
  sellerIds: string[];
  startsAt: Date;
  endsAt: Date;
  active: boolean;
}

export interface CouponLine {
  key: string;
  sellerId: string;
  /** The line's category and all its ancestors. */
  categoryIds: string[];
  lineTotalPaise: number;
}

export type CouponResult =
  | { ok: true; discountPaise: number; allocation: Map<string, number> }
  | { ok: false; code: CouponErrorCode; message: string };

const fail = (code: CouponErrorCode, message: string): CouponResult => ({
  ok: false,
  code,
  message,
});

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export function evaluateCoupon(
  coupon: CouponDef | null,
  ctx: { now: Date; userRedemptions: number; lines: CouponLine[] },
): CouponResult {
  if (!coupon || !coupon.active) return fail('COUPON_NOT_FOUND', 'This coupon code is not valid');
  if (ctx.now < coupon.startsAt) return fail('COUPON_NOT_STARTED', 'This coupon is not active yet');
  if (ctx.now >= coupon.endsAt) return fail('COUPON_EXPIRED', 'This coupon has expired');
  if (ctx.userRedemptions >= coupon.perUserLimit) {
    return fail('COUPON_USAGE_LIMIT', 'You have already used this coupon');
  }
  if (coupon.totalLimit !== null && coupon.usedCount >= coupon.totalLimit) {
    return fail('COUPON_USAGE_LIMIT', 'This coupon has been fully redeemed');
  }
  const eligible = ctx.lines.filter(
    (l) =>
      l.lineTotalPaise > 0 &&
      (coupon.sellerIds.length === 0 || coupon.sellerIds.includes(l.sellerId)) &&
      (coupon.categoryIds.length === 0 ||
        l.categoryIds.some((c) => coupon.categoryIds.includes(c))),
  );
  if (eligible.length === 0) {
    return fail('COUPON_NOT_APPLICABLE', 'This coupon does not apply to items in your order');
  }
  const base = eligible.reduce((s, l) => s + l.lineTotalPaise, 0);
  if (base < coupon.minOrderPaise) {
    return fail(
      'COUPON_MIN_ORDER',
      `Add items worth ${rupees(coupon.minOrderPaise - base)} more to use this coupon`,
    );
  }
  let discount = coupon.type === 'FLAT' ? coupon.value : Math.floor((base * coupon.value) / 10_000);
  if (coupon.maxDiscountPaise !== null) discount = Math.min(discount, coupon.maxDiscountPaise);
  discount = Math.max(0, Math.min(discount, base));
  return { ok: true, discountPaise: discount, allocation: allocate(eligible, base, discount) };
}

function allocate(lines: CouponLine[], base: number, discount: number): Map<string, number> {
  const out = new Map<string, number>();
  let left = discount;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? left : Math.floor((discount * l.lineTotalPaise) / base);
    out.set(l.key, share);
    left -= share;
  });
  return out;
}

/** Codes are case-insensitive; stored uppercase. */
export function normaliseCouponCode(code: string): string {
  return code.trim().toUpperCase();
}
