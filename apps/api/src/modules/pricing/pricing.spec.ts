import { DEFAULT_GST_BP, priceInfo, resolveGstBp } from './pricing';

describe('priceInfo', () => {
  it('computes discount and extracts inclusive GST', () => {
    // ₹1,180 incl. 18% GST → ₹180 GST; MRP ₹1,999 → 40% off (floor of 40.97)
    expect(priceInfo(118_000n, 199_900n, 1800)).toEqual({
      price: 118_000,
      mrp: 199_900,
      discountPercent: 40,
      gstRatePercent: 18,
      gstAmount: 18_000,
      taxInclusive: true,
    });
  });

  it('rounds GST half up to the paisa', () => {
    // 999 * 5 / 105 = 47.571… → 48
    expect(priceInfo(999, 999, 500).gstAmount).toBe(48);
    // 1050 * 5 / 105 = 50 exactly
    expect(priceInfo(1050, 1050, 500).gstAmount).toBe(50);
  });

  it('shows 0% off when MRP equals price and clamps MRP below price', () => {
    expect(priceInfo(5000, 5000, 1200).discountPercent).toBe(0);
    expect(priceInfo(5000, 4000, 1200)).toMatchObject({ mrp: 5000, discountPercent: 0 });
  });

  it('handles zero-rated goods and fractional rates', () => {
    expect(priceInfo(10_000, 12_000, 0).gstAmount).toBe(0);
    expect(priceInfo(10_000, 12_000, 250).gstRatePercent).toBe(2.5);
  });

  it('rejects non-positive prices', () => {
    expect(() => priceInfo(0, 100, 1800)).toThrow();
  });
});

describe('resolveGstBp', () => {
  it('uses the nearest category with a rate, else the default', () => {
    expect(resolveGstBp([{ gstRateBp: null }, { gstRateBp: 500 }, { gstRateBp: 1800 }])).toBe(500);
    expect(resolveGstBp([{ gstRateBp: null }])).toBe(DEFAULT_GST_BP);
  });
});
