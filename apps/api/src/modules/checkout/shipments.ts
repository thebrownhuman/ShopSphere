import type { DeliveryChoice, DeliveryOptionType, DeliveryOptionView } from '@shopsphere/types';
import {
  DELIVERY_FEE_PAISE,
  estimateDelivery,
  FREE_DELIVERY_MIN_PAISE,
  zoneFor,
} from '../delivery/delivery-estimate';

/**
 * Shipment splitting (M4.5): one shipment per seller (a seller ships from one warehouse in v1;
 * ShopSphere's own warehouses are first-party sellers). Each shipment gets its own delivery
 * options and charge:
 *   STANDARD  free when ShopSphere-fulfilled or the order's items total ≥ ₹499, else ₹40.
 *   ONE_DAY   ShopSphere-fulfilled, non-national/remote lanes only; ₹99; next day after dispatch.
 *   SCHEDULED grocery / large items; pick one of 3 dates from the standard date; standard fee.
 */

export const ONE_DAY_FEE_PAISE = 9_900;
const SCHEDULED_CATEGORY = /(^|\/)(grocery|groceries|appliances?|large-appliances|furniture)(\/|$)/;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60 * 1000;

export interface SplitLine {
  key: string;
  sellerId: string;
  sellerName: string;
  sellerPincode: string;
  cutoffHour: number;
  fulfilledByShopSphere: boolean;
  categoryPath: string;
  lineTotalPaise: number;
}

export interface SplitShipment<L extends SplitLine> {
  key: string;
  sellerId: string;
  sellerName: string;
  fulfilledByShopSphere: boolean;
  lines: L[];
  options: DeliveryOptionView[];
  selected: DeliveryChoice;
  deliveryDate: string;
  deliveryFeePaise: number;
  itemsPaise: number;
}

function addIstDays(date: string, days: number): string {
  let t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  if (new Date(t).getUTCDay() === 0) t += DAY_MS; // no Sunday deliveries
  return new Date(t).toISOString().slice(0, 10);
}

function istDate(t: Date): string {
  return new Date(t.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function deliveryOptions(
  lines: SplitLine[],
  toPin: string,
  orderItemsPaise: number,
  now: Date,
): DeliveryOptionView[] {
  const first = lines[0];
  const fbs = lines.every((l) => l.fulfilledByShopSphere);
  const est = estimateDelivery({
    fromPin: first.sellerPincode,
    toPin,
    fulfilledByShopSphere: fbs,
    cutoffHour: first.cutoffHour,
    pricePaise: 0,
    now,
  });
  const standardFee = fbs || orderItemsPaise >= FREE_DELIVERY_MIN_PAISE ? 0 : DELIVERY_FEE_PAISE;
  const out: DeliveryOptionView[] = [
    {
      type: 'STANDARD',
      label: 'Standard delivery',
      feePaise: standardFee,
      deliveryDate: est.deliveryDate,
    },
  ];
  const zone = zoneFor(first.sellerPincode, toPin);
  if (fbs && zone !== 'REMOTE' && zone !== 'NATIONAL') {
    out.push({
      type: 'ONE_DAY',
      label: 'One-day delivery',
      feePaise: ONE_DAY_FEE_PAISE,
      deliveryDate: addIstDays(istDate(est.cutoffAt), 1),
    });
  }
  if (lines.some((l) => SCHEDULED_CATEGORY.test(l.categoryPath))) {
    const slots = [0, 1, 2].map((d) =>
      d === 0 ? est.deliveryDate : addIstDays(est.deliveryDate, d),
    );
    out.push({
      type: 'SCHEDULED',
      label: 'Scheduled delivery',
      feePaise: standardFee,
      deliveryDate: slots[0],
      slots: [...new Set(slots)],
    });
  }
  return out;
}

export function splitShipments<L extends SplitLine>(
  lines: L[],
  toPin: string,
  choices: DeliveryChoice[],
  now: Date,
): SplitShipment<L>[] {
  const bySeller = new Map<string, L[]>();
  for (const l of lines) bySeller.set(l.sellerId, [...(bySeller.get(l.sellerId) ?? []), l]);
  const orderItems = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  return [...bySeller.entries()].map(([sellerId, group]) => {
    const key = `s:${sellerId}`;
    const options = deliveryOptions(group, toPin, orderItems, now);
    const wanted = choices.find((c) => c.shipmentKey === key);
    const opt = options.find((o) => o.type === wanted?.type) ?? options[0];
    const slot =
      opt.type === 'SCHEDULED' && wanted?.slotDate && opt.slots?.includes(wanted.slotDate)
        ? wanted.slotDate
        : undefined;
    return {
      key,
      sellerId,
      sellerName: group[0].sellerName,
      fulfilledByShopSphere: group.every((l) => l.fulfilledByShopSphere),
      lines: group,
      options,
      selected: {
        shipmentKey: key,
        type: opt.type as DeliveryOptionType,
        ...(slot ? { slotDate: slot } : {}),
      },
      deliveryDate: slot ?? opt.deliveryDate,
      deliveryFeePaise: opt.feePaise,
      itemsPaise: group.reduce((s, l) => s + l.lineTotalPaise, 0),
    };
  });
}
