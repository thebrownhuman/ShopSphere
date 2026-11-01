import { lineTax, sumTax } from '../tax/gst';
import { allocateDiscount } from './allocate';

describe('allocateDiscount', () => {
  it('splits proportionally and sums exactly', () => {
    const s = allocateDiscount([100_00, 200_00, 33_33], 33_33);
    expect(s.reduce((a, x) => a + x, 0)).toBe(33_33);
    expect(s[1]).toBeGreaterThan(s[0]);
  });

  it('never exceeds a line and handles zero', () => {
    expect(allocateDiscount([1, 1, 1], 5)).toEqual([1, 1, 1]);
    expect(allocateDiscount([500, 0], 0)).toEqual([0, 0]);
    expect(allocateDiscount([0, 0], 100)).toEqual([0, 0]);
  });

  it('reconciles: per-line GST on discounted lines equals tax on the order total', () => {
    // 10% bank offer on three lines at different rates, inter + intra state.
    const lines = [
      { amount: 1_499_00, rate: 1800 },
      { amount: 349_00, rate: 500 },
      { amount: 79_999_00, rate: 1800 },
    ];
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const bank = Math.floor(total / 10);
    const share = allocateDiscount(
      lines.map((l) => l.amount),
      bank,
    );
    const taxes = lines.map((l, i) =>
      lineTax(l.amount - share[i], l.rate, 'Karnataka', 'Karnataka'),
    );
    const gross = taxes.reduce((a, t) => a + t.taxablePaise + t.cgstPaise + t.sgstPaise, 0);
    // Invoice gross (taxable + GST) = what the shopper pays for the goods.
    expect(gross).toBe(total - bank);
    expect(sumTax(taxes).totalPaise).toBe(gross - taxes.reduce((a, t) => a + t.taxablePaise, 0));
  });
});
