import { createHash } from 'node:crypto';
import { GST_STATE_CODES, makeGstin } from '../seller/kyc-validation';
import type { Tx } from '../shared/prisma/prisma.service';

export interface SellerTaxProfile {
  gstin: string;
  /** One line: street, city, state - pincode. */
  address: string;
}

/** Deterministic, valid-looking PAN for a seller with no KYC on file (simulation only). */
function simulatedPan(sellerId: string): string {
  const h = createHash('sha256').update(sellerId).digest();
  const letter = (i: number) => String.fromCharCode(65 + (h[i] % 26));
  const digits = String(h.readUInt16BE(10) % 10_000).padStart(4, '0');
  // 4th character "C" = company.
  return `${letter(0)}${letter(1)}${letter(2)}C${letter(4)}${digits}${letter(12)}`;
}

export function stateCodeFor(state: string): string {
  const want = state.trim().toLowerCase();
  return Object.entries(GST_STATE_CODES).find(([, s]) => s.toLowerCase() === want)?.[0] ?? '27';
}

/**
 * Invoice identity of each seller: the approved Seller Central GSTIN + pickup address when there
 * is one, otherwise a simulated GSTIN for the seller's state and the city/state/pincode on file.
 */
export async function sellerTaxProfiles(
  tx: Tx,
  sellerIds: string[],
): Promise<Map<string, SellerTaxProfile>> {
  const ids = [...new Set(sellerIds)];
  const sellers = await tx.seller.findMany({
    where: { id: { in: ids } },
    include: { account: true },
  });
  const out = new Map<string, SellerTaxProfile>();
  for (const s of sellers) {
    const pickup = (s.account?.pickup ?? null) as {
      line1?: string;
      line2?: string | null;
      city?: string;
      state?: string;
      pincode?: string;
    } | null;
    const address = pickup?.line1
      ? [pickup.line1, pickup.line2, pickup.city, `${pickup.state} - ${pickup.pincode}`]
      : [s.city, `${s.state} - ${s.pincode}`];
    out.set(s.id, {
      gstin: s.account?.gstin ?? makeGstin(stateCodeFor(s.state), simulatedPan(s.id)),
      address: address.filter(Boolean).join(', '),
    });
  }
  return out;
}
