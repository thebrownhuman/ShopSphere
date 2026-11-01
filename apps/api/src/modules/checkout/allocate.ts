/**
 * Splits `discount` paise over lines in proportion to `amounts` (largest-remainder method):
 * shares are integers, sum to exactly `discount`, and never exceed a line's amount.
 * Used for the bank offer (M6.6) so per-line GST is computed on the discounted value.
 */
export function allocateDiscount(amounts: number[], discount: number): number[] {
  const base = amounts.reduce((a, x) => a + Math.max(0, x), 0);
  if (discount <= 0 || base <= 0) return amounts.map(() => 0);
  const d = Math.min(discount, base);
  const exact = amounts.map((x) => (Math.max(0, x) * d) / base);
  const shares = exact.map(Math.floor);
  let left = d - shares.reduce((a, x) => a + x, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    if (shares[i] < amounts[i]) {
      shares[i] += 1;
      left -= 1;
    }
  }
  return shares;
}
