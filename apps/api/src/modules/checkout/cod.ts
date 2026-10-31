/**
 * Cash on Delivery rules (M4.19, PRD §9): limit ₹50,000, pincode must be serviceable and not a
 * remote lane, and a simple fraud score can switch COD off (force prepaid).
 */

export const COD_MAX_PAISE = 5_000_000;
export const COD_FEE_PAISE = 1_000;
export const COD_RISK_THRESHOLD = 70;
const REMOTE_PREFIXES = [/^744/, /^194/, /^737/, /^7[89]/];

export interface RiskInput {
  /** Orders this user placed before (any status). */
  priorOrders: number;
  /** Orders placed in the last hour (velocity). */
  ordersLastHour: number;
  totalPaise: number;
}

/** 0–100. High-value first orders and order bursts are the v1 signals. */
export function riskScore(r: RiskInput): number {
  let score = 0;
  if (r.priorOrders === 0 && r.totalPaise > 1_000_000) score += 40;
  if (r.ordersLastHour >= 3) score += 40;
  if (r.ordersLastHour >= 6) score += 40;
  if (r.totalPaise > 2_500_000) score += 10;
  return Math.min(100, score);
}

export type CodVerdict = { available: true; reason: null } | { available: false; reason: string };

export function codVerdict(input: {
  payablePaise: number;
  pincode: string;
  pincodeServiceable: boolean;
  risk: number;
}): CodVerdict {
  if (input.payablePaise > COD_MAX_PAISE) return { available: false, reason: 'COD_LIMIT' };
  if (!input.pincodeServiceable || REMOTE_PREFIXES.some((r) => r.test(input.pincode))) {
    return { available: false, reason: 'COD_PINCODE' };
  }
  if (input.risk >= COD_RISK_THRESHOLD) return { available: false, reason: 'COD_RISK' };
  return { available: true, reason: null };
}
