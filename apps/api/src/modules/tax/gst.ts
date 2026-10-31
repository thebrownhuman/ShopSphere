import type { LineTax } from '@shopsphere/types';

/**
 * GST per line (M4.8). Selling prices are GST-inclusive, so tax is carved out of the amount the
 * shopper pays for the line (after any coupon discount):
 *   taxable = round(amount × 10000 / (10000 + rateBp)),  tax = amount − taxable.
 * Same state (seller vs delivery address) → CGST + SGST, half each (odd paisa to SGST);
 * different states → IGST. Marketplace model: the seller is the supplier, so the seller's state
 * is the place of supply origin.
 */

export const DEFAULT_GST_BP = 1800;

/** Lowercased, whitespace-collapsed; "&" and "and" treated alike ("Jammu & Kashmir"). */
export function normaliseState(state: string): string {
  return state.trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');
}

export function isIntraState(sellerState: string, shipToState: string): boolean {
  return normaliseState(sellerState) === normaliseState(shipToState);
}

export function lineTax(
  amountPaise: number,
  rateBp: number,
  sellerState: string,
  shipToState: string,
): LineTax {
  if (!Number.isInteger(amountPaise) || amountPaise < 0) {
    throw new Error(`lineTax: amount must be a non-negative integer, got ${amountPaise}`);
  }
  const taxable = Math.round((amountPaise * 10_000) / (10_000 + rateBp));
  const tax = amountPaise - taxable;
  if (isIntraState(sellerState, shipToState)) {
    const cgst = Math.floor(tax / 2);
    return { rateBp, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: tax - cgst, igstPaise: 0 };
  }
  return { rateBp, taxablePaise: taxable, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
}

export function sumTax(taxes: LineTax[]) {
  const t = { cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
  for (const x of taxes) {
    t.cgstPaise += x.cgstPaise;
    t.sgstPaise += x.sgstPaise;
    t.igstPaise += x.igstPaise;
  }
  t.totalPaise = t.cgstPaise + t.sgstPaise + t.igstPaise;
  return t;
}
