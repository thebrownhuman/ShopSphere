const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

/** Format integer paise as an INR string, e.g. 129900 -> "₹1,299.00". */
export function formatPaise(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error('paise must be an integer');
  return inr.format(paise / 100);
}

/** Shelf-price format: drops ".00" for whole rupees, e.g. 129900 -> "₹1,299". */
export function formatPrice(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error('paise must be an integer');
  return paise % 100 === 0 ? inrWhole.format(paise / 100) : inr.format(paise / 100);
}

/** Whole-number discount percentage, floored so a saving is never overstated. */
export function discountPercent(pricePaise: number, mrpPaise: number): number {
  if (mrpPaise <= 0 || pricePaise >= mrpPaise) return 0;
  return Math.floor(((mrpPaise - pricePaise) / mrpPaise) * 100);
}

/** Compact Indian count, e.g. 1234 -> "1,234", 123456 -> "1.2L". */
export function formatCount(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (n >= 100_000) return `${(n / 100_000).toFixed(1).replace(/\.0$/, '')}L`;
  return new Intl.NumberFormat('en-IN').format(n);
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
