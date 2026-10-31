import type { SettlementBreakdown } from '@shopsphere/types';

/**
 * Seller settlement per delivered shipment (M5.7, PRD §9 "Seller payouts"). All integer paise,
 * rounded half-up per component, so the statement adds up exactly:
 *
 *   gross       = Σ items (taxable + GST) the buyer paid for this seller's shipment
 *   commission  = gross × commission rate
 *   shippingFee = courier cost − delivery fee the buyer already paid (never negative)
 *   feesGst     = 18% GST on (commission + shippingFee)   (ShopSphere's service to the seller)
 *   TCS         = 1% of taxable value                     (CGST Act §52: 0.5% CGST + 0.5% SGST/IGST)
 *   TDS         = 0.1% of gross                           (Income-tax §194-O, from 1 Oct 2024)
 *   net         = gross − commission − shippingFee − feesGst − TCS − TDS
 */
export interface SettlementRates {
  commissionBp: number;
  feesGstBp: number;
  tcsBp: number;
  tdsBp: number;
}

export const DEFAULT_RATES: SettlementRates = {
  commissionBp: 1_000,
  feesGstBp: 1_800,
  tcsBp: 100,
  tdsBp: 10,
};

export interface SettlementInput {
  items: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }[];
  courierCostPaise: number;
  buyerDeliveryFeePaise: number;
}

/** round(amount × bp / 10000), half-up, integer-exact. */
export function pct(amount: number, bp: number): number {
  return Math.floor((amount * bp + 5_000) / 10_000);
}

export function settle(input: SettlementInput, rates = DEFAULT_RATES): SettlementBreakdown {
  const taxablePaise = input.items.reduce((s, i) => s + i.taxablePaise, 0);
  const grossPaise = input.items.reduce(
    (s, i) => s + i.taxablePaise + i.cgstPaise + i.sgstPaise + i.igstPaise,
    0,
  );
  const commissionPaise = pct(grossPaise, rates.commissionBp);
  const shippingFeePaise = Math.max(0, input.courierCostPaise - input.buyerDeliveryFeePaise);
  const feesGstPaise = pct(commissionPaise + shippingFeePaise, rates.feesGstBp);
  const tcsPaise = pct(taxablePaise, rates.tcsBp);
  const tdsPaise = pct(grossPaise, rates.tdsBp);
  return {
    grossPaise,
    taxablePaise,
    commissionPaise,
    feesGstPaise,
    shippingFeePaise,
    tcsPaise,
    tdsPaise,
    netPaise: grossPaise - commissionPaise - shippingFeePaise - feesGstPaise - tcsPaise - tdsPaise,
  };
}

export const PAYOUT_DELAY_DAYS = 7;

/** T+7: a delivered shipment's money is payable 7 days after delivery (return window). */
export function eligibleAt(deliveredAt: Date, delayDays = PAYOUT_DELAY_DAYS): Date {
  return new Date(deliveredAt.getTime() + delayDays * 86_400_000);
}

export interface DueLine {
  id: string;
  sellerId: string;
  netPaise: number;
  eligibleAt: Date;
}

/**
 * Groups lines due by `now` into one payout per seller. A seller whose due lines net to ≤ 0
 * (e.g. charges exceeded sales) is skipped; the lines stay pending and offset future sales.
 */
export function planPayouts(
  lines: DueLine[],
  now: Date,
): { sellerId: string; amountPaise: number; lineIds: string[] }[] {
  const bySeller = new Map<string, DueLine[]>();
  for (const l of lines) {
    if (l.eligibleAt.getTime() > now.getTime()) continue;
    bySeller.set(l.sellerId, [...(bySeller.get(l.sellerId) ?? []), l]);
  }
  return [...bySeller.entries()]
    .map(([sellerId, ls]) => ({
      sellerId,
      amountPaise: ls.reduce((s, l) => s + l.netPaise, 0),
      lineIds: ls.map((l) => l.id),
    }))
    .filter((p) => p.amountPaise >= 100)
    .sort((a, b) => a.sellerId.localeCompare(b.sellerId));
}
