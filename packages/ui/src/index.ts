/** Shared design system. Components (Button, Input, Modal, ...) arrive in M0.6. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** Format integer paise as an INR string, e.g. 129900 -> "₹1,299.00". */
export function formatPaise(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error('paise must be an integer');
  return inr.format(paise / 100);
}
