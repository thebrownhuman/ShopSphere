import type { PriceInfo } from '@shopsphere/types';

/** Default GST when no category in the path sets one (18%, the common standard rate). */
export const DEFAULT_GST_BP = 1800;

/**
 * Price display block (M2.6). Selling prices are GST inclusive (B2C India), so the GST
 * portion is extracted, not added: gst = price * rate / (100 + rate), rounded half up.
 */
export function priceInfo(
  price: bigint | number,
  mrp: bigint | number,
  gstRateBp: number,
): PriceInfo {
  const p = BigInt(price);
  const m = BigInt(mrp) < p ? p : BigInt(mrp);
  if (p <= 0n) throw new Error('price must be positive');
  const discountPercent = m > p ? Number(((m - p) * 100n) / m) : 0;
  const bp = BigInt(gstRateBp);
  const gstAmount = (p * bp * 2n + (10000n + bp)) / ((10000n + bp) * 2n);
  return {
    price: Number(p),
    mrp: Number(m),
    discountPercent,
    gstRatePercent: gstRateBp / 100,
    gstAmount: Number(gstAmount),
    taxInclusive: true,
  };
}

/** Resolves a category's GST rate: nearest ancestor (self first) with a rate set. */
export function resolveGstBp(chain: { gstRateBp: number | null }[]): number {
  for (const c of chain) if (c.gstRateBp != null) return c.gstRateBp;
  return DEFAULT_GST_BP;
}
