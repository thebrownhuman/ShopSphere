import type { DeliveryZone } from '@shopsphere/types';

/**
 * Delivery estimate (M2.7). Zone rules and SLA days come from the courier's serviceability
 * matrix (M5.6a, refreshed nightly) when one has been fetched; the built-in table below is the
 * fallback. All calendar math happens in IST (UTC+05:30, no DST).
 */

/** Courier lane rules (subset of shipping's ServiceabilityMatrix). */
export interface LaneRules {
  metroPrefixes: string[];
  remotePatterns: string[];
  unserviceablePatterns: string[];
  slaDays: Record<DeliveryZone, number>;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** First three digits of metro sorting districts. */
const METRO_PREFIXES = new Set(['110', '400', '560', '600', '700', '500', '411', '380']);
/** Islands, Ladakh, Sikkim and the North-East: slow lanes. */
const REMOTE_PREFIXES = [/^744/, /^194/, /^737/, /^7[89]/];

export const ZONE_SLA_DAYS: Record<DeliveryZone, number> = {
  LOCAL: 1,
  REGIONAL: 2,
  METRO: 2,
  NATIONAL: 4,
  REMOTE: 7,
};

export const FREE_DELIVERY_MIN_PAISE = 49_900;
export const DELIVERY_FEE_PAISE = 4_000;

export function isValidPincode(pin: string): boolean {
  return /^[1-9]\d{5}$/.test(pin);
}

export function zoneFor(fromPin: string, toPin: string, lanes?: LaneRules): DeliveryZone {
  const remote = lanes ? lanes.remotePatterns.map((p) => new RegExp(p)) : REMOTE_PREFIXES;
  const metro = lanes ? new Set(lanes.metroPrefixes) : METRO_PREFIXES;
  if (remote.some((r) => r.test(toPin))) return 'REMOTE';
  if (fromPin.slice(0, 3) === toPin.slice(0, 3)) return 'LOCAL';
  if (fromPin.slice(0, 2) === toPin.slice(0, 2)) return 'REGIONAL';
  if (metro.has(fromPin.slice(0, 3)) && metro.has(toPin.slice(0, 3))) return 'METRO';
  return 'NATIONAL';
}

/** False when the courier matrix excludes the destination (e.g. field post offices). */
export function courierServes(toPin: string, lanes?: LaneRules): boolean {
  return !lanes?.unserviceablePatterns.some((p) => new RegExp(p).test(toPin));
}

/** ShopSphere-fulfilled (Plus) ships a day faster except to remote zones. */
export function slaDays(
  zone: DeliveryZone,
  fulfilledByShopSphere: boolean,
  lanes?: LaneRules,
): number {
  const base = lanes?.slaDays[zone] ?? ZONE_SLA_DAYS[zone];
  return fulfilledByShopSphere && zone !== 'REMOTE' ? Math.max(1, base - 1) : base;
}

export interface EstimateInput {
  fromPin: string;
  toPin: string;
  fulfilledByShopSphere: boolean;
  /** Seller's dispatch cutoff hour, IST. */
  cutoffHour: number;
  pricePaise: number;
  now: Date;
  /** Courier matrix; omitted = built-in table. */
  lanes?: LaneRules;
}

export interface Estimate {
  zone: DeliveryZone;
  slaDays: number;
  /** YYYY-MM-DD (IST). */
  deliveryDate: string;
  cutoffAt: Date;
  cutoffSecondsRemaining: number;
  freeDelivery: boolean;
  deliveryFee: number;
}

const DAY_MS = 86_400_000;

/** IST midnight of the IST day containing `t`, as a UTC epoch. */
function istDayStart(t: number): number {
  return Math.floor((t + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

function istDateString(t: number): string {
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function istWeekday(t: number): number {
  return new Date(t + IST_OFFSET_MS).getUTCDay();
}

export function estimateDelivery(input: EstimateInput): Estimate {
  const zone = zoneFor(input.fromPin, input.toPin, input.lanes);
  const sla = slaDays(zone, input.fulfilledByShopSphere, input.lanes);
  const now = input.now.getTime();
  let cutoff = istDayStart(now) + input.cutoffHour * 3_600_000;
  if (now >= cutoff) cutoff += DAY_MS;
  // Dispatch on the cutoff's day; couriers do not deliver on Sundays.
  let delivery = istDayStart(cutoff) + sla * DAY_MS;
  if (istWeekday(delivery) === 0) delivery += DAY_MS;
  const freeDelivery = input.fulfilledByShopSphere || input.pricePaise >= FREE_DELIVERY_MIN_PAISE;
  return {
    zone,
    slaDays: sla,
    deliveryDate: istDateString(delivery),
    cutoffAt: new Date(cutoff),
    cutoffSecondsRemaining: Math.floor((cutoff - now) / 1000),
    freeDelivery,
    deliveryFee: freeDelivery ? 0 : DELIVERY_FEE_PAISE,
  };
}
