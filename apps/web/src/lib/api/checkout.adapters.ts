import type {
  Address,
  CheckoutSession as ApiSession,
  OrderDetail as ApiOrderDetail,
  OrderEvent as ApiOrderEvent,
  OrderStatusResponse,
  OrderSummary as ApiOrderSummary,
  OrderTotals,
  CheckoutTotals,
  PaymentMethodChoice,
  OrderPaymentMethod,
  PaymentProviderName,
} from '@shopsphere/types';
import type {
  CheckoutAddress,
  CheckoutIssue,
  CheckoutSession,
  OrderPaymentStatus,
  PaymentMethod,
  PaymentMethodOption,
  PriceBreakdown,
} from './checkout.types';
import type { OrderDetail, OrderStatus, OrderSummary, TrackingEvent } from './orders.types';

/**
 * Backend DTOs (packages/types/src/{checkout,order}.ts) → web view types. The view keeps one
 * method list (BANK / RAZORPAY / COD / GIFT_CARD); the API models online gateways as
 * {type:'ONLINE', provider} and gift card / ShopSphere Pay as a store-balance toggle.
 */

export const methodFromChoice = (m: PaymentMethodChoice | null): PaymentMethod | null =>
  !m ? null : m.type === 'COD' ? 'COD' : m.provider === 'razorpay' ? 'RAZORPAY' : 'BANK';

export const choiceFromMethod = (m: PaymentMethod): PaymentMethodChoice | null =>
  m === 'COD'
    ? { type: 'COD' }
    : m === 'RAZORPAY'
      ? { type: 'ONLINE', provider: 'razorpay' }
      : m === 'BANK'
        ? { type: 'ONLINE', provider: 'bank' }
        : null;

const REASONS: Record<string, string> = {
  COD_LIMIT: 'Not available for this order value',
  COD_PINCODE: 'Not available at this pincode',
  COD_RISK: 'Not available for this order',
  PROVIDER_DISABLED: 'Not configured',
};

export function toPrice(t: CheckoutTotals | OrderTotals, savings?: number): PriceBreakdown {
  return {
    items: t.itemsPaise,
    mrp: t.mrpPaise,
    delivery: t.deliveryPaise,
    discount: t.couponDiscountPaise,
    giftCard: t.storeBalancePaise,
    codFee: t.codFeePaise,
    total: t.payablePaise,
    savings: savings ?? ('savingsPaise' in t ? t.savingsPaise : 0),
  };
}

function toAddress(a: Address | ApiSession['address']): CheckoutAddress {
  return {
    id: a!.id,
    name: a!.name,
    phone: a!.phone,
    line1: a!.line1,
    line2: a!.line2,
    landmark: a!.landmark,
    city: a!.city,
    state: a!.state,
    pincode: a!.pincode,
    type: 'type' in a! && a.type.toLowerCase() === 'work' ? 'WORK' : 'HOME',
    isDefault: 'isDefault' in a! ? a.isDefault : false,
  };
}

export function toSession(s: ApiSession, saved: Address[]): CheckoutSession {
  const addresses = saved.map(toAddress);
  if (s.address && !addresses.some((a) => a.id === s.address!.id))
    addresses.unshift(toAddress(s.address));

  const methods: PaymentMethodOption[] = s.paymentOptions.map((o) => ({
    method: methodFromChoice(o.method)!,
    label:
      o.method.type === 'ONLINE' && o.method.provider === 'bank'
        ? 'ShopSphere Bank (cards, UPI, net banking)'
        : o.label,
    enabled: o.available,
    reason: o.reason ? (REASONS[o.reason] ?? o.reason) : null,
  }));
  const balance = s.storeBalance.availablePaise;
  methods.push({
    method: 'GIFT_CARD',
    label: 'Gift card balance',
    enabled: balance > 0 && balance >= s.totals.totalPaise,
    reason: balance > 0 ? 'Balance does not cover the order' : 'Add a gift card first',
  });

  const lines = s.shipments.flatMap((sh) => sh.lines);
  const issues: CheckoutIssue[] = [];
  const unserviceable = lines.filter((l) => l.issue === 'UNSERVICEABLE').map((l) => l.skuId);
  if (unserviceable.length)
    issues.push({
      code: 'NOT_SERVICEABLE',
      message: `Some items can't be delivered to ${s.address?.pincode ?? 'this address'}`,
      lineIds: unserviceable,
    });
  const gone = lines
    .filter((l) => l.issue === 'OUT_OF_STOCK' || l.issue === 'UNAVAILABLE')
    .map((l) => l.skuId);
  if (gone.length)
    issues.push({
      code: 'OUT_OF_STOCK',
      message: 'Some items are no longer available',
      lineIds: gone,
    });

  return {
    id: s.id,
    source: s.source,
    expiresAt: s.expiresAt,
    addresses,
    addressId: s.address?.id ?? null,
    shipments: s.shipments.map((sh) => ({
      id: sh.key,
      sellerId: sh.sellerId,
      sellerName: sh.sellerName,
      fulfilment: sh.fulfilledByShopSphere ? 'SHOPSPHERE' : 'SELLER',
      items: sh.lines.map((l) => ({
        lineId: l.skuId,
        skuId: l.skuId,
        slug: l.slug,
        title: l.variant ? `${l.title} (${l.variant})` : l.title,
        variant: {},
        image: l.imageUrl,
        qty: l.qty,
        unitPrice: l.unitPricePaise,
        mrp: l.mrpPaise,
        lineTotal: l.lineTotalPaise,
        serviceable: l.issue !== 'UNSERVICEABLE',
      })),
      options: sh.options.map((o) => ({
        speed: o.type,
        label: o.label,
        fee: o.feePaise,
        deliveryDate: o.deliveryDate,
        slots: o.slots ?? [],
      })),
      selected: sh.selected.type,
      slot: sh.selected.slotDate ?? null,
    })),
    methods,
    paymentMethod:
      s.totals.payablePaise === 0 && s.storeBalance.applied
        ? 'GIFT_CARD'
        : methodFromChoice(s.paymentMethod),
    coupon: s.coupon ? { code: s.coupon.code, discount: s.coupon.discountPaise } : null,
    giftCard:
      balance > 0 || s.storeBalance.applied
        ? { balance, applied: s.storeBalance.applied ? s.totals.storeBalancePaise : 0 }
        : null,
    price: toPrice(s.totals),
    issues,
  };
}

export const providerOf = (m: PaymentMethod | null): PaymentProviderName =>
  m === 'RAZORPAY' ? 'razorpay' : 'bank';

// ───────── Orders ─────────

const mapStatus = (s: string): OrderStatus => s as OrderStatus;

const toMethod = (m: OrderPaymentMethod, provider: PaymentProviderName | null): PaymentMethod =>
  m === 'COD'
    ? 'COD'
    : m === 'STORE_BALANCE'
      ? 'GIFT_CARD'
      : provider === 'razorpay'
        ? 'RAZORPAY'
        : 'BANK';

export function toOrderSummary(o: ApiOrderSummary): OrderSummary {
  return {
    id: o.id,
    number: o.number,
    placedAt: o.placedAt,
    status: mapStatus(o.status),
    total: o.totalPaise,
    itemCount: o.itemCount,
    items: o.previews.map((p) => ({ title: p.title, image: p.imageUrl, slug: p.slug ?? '' })),
    // Delivered: the actual day (IST); otherwise the latest promised day.
    deliveryDate:
      o.previews
        .map((p) => (p.deliveredAt ? istDay(p.deliveredAt) : (p.expectedDeliveryDate ?? null)))
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null,
    replacementOfId: o.replacementOfId ?? null,
  };
}

const istDay = (iso: string) =>
  new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);

const courierLabel = (c: string) => (c === 'courier-sim' ? 'ShopSphere Logistics' : c);

const tracking = (events: ApiOrderEvent[]): TrackingEvent[] =>
  events.map((e) => ({
    status: mapStatus(e.toStatus),
    at: e.createdAt,
    note: e.awb ? `${e.courier ? `${courierLabel(e.courier)} · ` : ''}AWB ${e.awb}` : e.note,
  }));

export function toOrderDetail(o: ApiOrderDetail): OrderDetail {
  const events = tracking(o.events);
  const status = mapStatus(o.status);
  const promised =
    o.shipments
      .map((s) => s.promisedDate)
      .sort()
      .at(-1) ?? null;
  return {
    ...toOrderSummary(o),
    deliveryDate: promised,
    replacementOf: o.replacementOf ?? null,
    replacedBy: o.replacedBy ?? null,
    paymentMethod: toMethod(o.payment.method, o.payment.provider),
    address: toAddress(o.address),
    price: toPrice(
      o.totals,
      Math.max(0, o.totals.mrpPaise - o.totals.itemsPaise) + o.totals.couponDiscountPaise,
    ),
    cancellable: o.canCancel,
    shipments: o.shipments.map((s) => {
      // Shipment status follows the order until per-shipment events exist.
      const shStatus: OrderStatus =
        s.status === 'PENDING' ? status : s.status === 'CANCELLED' ? status : mapStatus(s.status);
      return {
        id: s.id,
        sellerName: s.sellerName,
        status: shStatus,
        items: s.items.map((i) => ({
          skuId: i.skuId,
          slug: i.slug,
          title: i.variant ? `${i.title} (${i.variant})` : i.title,
          variant: {},
          image: i.imageUrl,
          qty: i.qty,
          unitPrice: i.unitPricePaise,
          lineTotal: i.lineTotalPaise,
        })),
        deliveryDate: s.deliveredAt ? istDay(s.deliveredAt) : s.promisedDate,
        trackingId: s.awb ?? null,
        carrier: s.courier ? courierLabel(s.courier) : null,
        tracking: events,
        invoiceAvailable: s.invoiceAvailable ?? false,
      };
    }),
  };
}

/** Failed attempts keep the order PENDING_PAYMENT (retryable); the view treats them as failed. */
export function toPaymentStatus(
  s: OrderStatusResponse,
  orderNumber: string,
  failureReason: string | null,
): OrderPaymentStatus {
  const status =
    s.status === 'PENDING_PAYMENT'
      ? s.paymentState === 'FAILED'
        ? 'PAYMENT_FAILED'
        : 'PENDING_PAYMENT'
      : s.status === 'PAYMENT_FAILED'
        ? 'CANCELLED'
        : s.status === 'CANCELLED' || s.status === 'CANCELLED_NO_STOCK'
          ? 'CANCELLED'
          : 'CONFIRMED';
  return {
    orderId: s.orderId,
    orderNumber,
    status,
    paymentState:
      s.paymentState === 'COD' || s.paymentState === 'NOT_REQUIRED'
        ? 'NOT_REQUIRED'
        : s.paymentState === 'PAID' || s.paymentState === 'PENDING' || s.paymentState === 'FAILED'
          ? s.paymentState
          : 'UNPAID',
    amount: s.payablePaise,
    failureReason:
      status === 'CANCELLED' && s.status === 'PAYMENT_FAILED'
        ? 'The payment window closed before the bank confirmed.'
        : failureReason,
    retryUntil: s.retryUntil,
  };
}
