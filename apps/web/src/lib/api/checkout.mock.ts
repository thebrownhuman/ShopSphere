import { ApiRequestError } from '../api';
import type {
  CheckoutItem,
  CheckoutPatch,
  CheckoutSession,
  CheckoutShipment,
  CheckoutSource,
  DeliveryOption,
  InitiatePaymentResponse,
  OrderPaymentStatus,
  PaymentMethod,
  PaymentMethodOption,
  PlaceOrderResponse,
  PriceBreakdown,
} from './checkout.types';
import { loadStore, MOCK_ADDRESSES, saveStore, setOrderStatus } from './orders.mock';

/**
 * Mock checkout (NEXT_PUBLIC_CHECKOUT_MOCK=1). Mirrors the server rules closely enough to
 * exercise every UI branch:
 * - coupon SAVE200 = ₹200 off orders of ₹1,000+; any other code is rejected
 * - gift card GIFT500 adds ₹500 balance
 * - pincodes starting with 9 cannot receive seller-fulfilled items
 * - `?mockPriceChange=1` on /checkout makes the first Place Order report a price rise
 * - online payments go to /checkout/mock-bank, a stand-in for the bank-sim hosted page
 */

const FREE_DELIVERY_MIN = 49_900;
const COD_FEE = 1_000;
const COD_LIMIT = 5_000_000;
const GIFT_CODES: Record<string, number> = { GIFT500: 50_000 };
const day = 86_400_000;
const ymd = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

const err = (status: number, code: string, message: string) =>
  new ApiRequestError(status, { code, message });

function item(
  lineId: string,
  skuId: string,
  slug: string,
  title: string,
  unitPrice: number,
  mrp: number,
  qty = 1,
): CheckoutItem {
  return {
    lineId,
    skuId,
    slug,
    title,
    variant: {},
    image: null,
    qty,
    unitPrice,
    mrp,
    lineTotal: unitPrice * qty,
    serviceable: true,
  };
}

function options(fulfilment: CheckoutShipment['fulfilment'], items: number): DeliveryOption[] {
  const opts: DeliveryOption[] = [
    {
      speed: 'STANDARD',
      label: 'Standard delivery',
      fee: items >= FREE_DELIVERY_MIN ? 0 : 4_000,
      deliveryDate: ymd(4),
      slots: [],
    },
    { speed: 'ONE_DAY', label: 'One-day delivery', fee: 9_900, deliveryDate: ymd(1), slots: [] },
  ];
  if (fulfilment === 'SHOPSPHERE')
    opts.push({
      speed: 'SCHEDULED',
      label: 'Scheduled slot',
      fee: 4_900,
      deliveryDate: ymd(2),
      slots: ['08:00–12:00', '12:00–16:00', '16:00–20:00'],
    });
  return opts;
}

function shipment(
  id: string,
  sellerId: string,
  sellerName: string,
  fulfilment: CheckoutShipment['fulfilment'],
  items: CheckoutItem[],
): CheckoutShipment {
  const sum = items.reduce((s, i) => s + i.lineTotal, 0);
  return {
    id,
    sellerId,
    sellerName,
    fulfilment,
    items,
    options: options(fulfilment, sum),
    selected: 'STANDARD',
    slot: null,
  };
}

function cartShipments(): CheckoutShipment[] {
  return [
    shipment('shp-1', 'seller-ss', 'ShopSphere Retail', 'SHOPSPHERE', [
      item(
        'line-1',
        'sku-phone-1',
        'redmi-note-13-5g',
        'Redmi Note 13 5G (Arctic White, 128 GB)',
        1_699_900,
        2_099_900,
      ),
    ]),
    shipment('shp-2', 'seller-7', 'Kitchen Mart', 'SELLER', [
      item(
        'line-2',
        'sku-bottle-1',
        'milton-thermosteel-1l',
        'Milton Thermosteel Flask 1 L',
        89_900,
        1_29_900,
        2,
      ),
    ]),
  ];
}

/** Server-side pricing stand-in (PRD §8 price breakdown). */
export function priceSession(s: CheckoutSession): PriceBreakdown {
  const lines = s.shipments.flatMap((sh) => sh.items);
  const items = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const mrp = lines.reduce((sum, l) => sum + l.mrp * l.qty, 0);
  const delivery = s.shipments.reduce(
    (sum, sh) => sum + (sh.options.find((o) => o.speed === sh.selected)?.fee ?? 0),
    0,
  );
  const discount = s.coupon?.discount ?? 0;
  const codFee = s.paymentMethod === 'COD' ? COD_FEE : 0;
  const due = items + delivery - discount + codFee;
  const giftCard = s.giftCard ? Math.min(s.giftCard.applied, due) : 0;
  return {
    items,
    mrp,
    delivery,
    discount,
    giftCard,
    codFee,
    total: due - giftCard,
    savings: mrp - items + discount,
  };
}

function methods(s: CheckoutSession, total: number): PaymentMethodOption[] {
  const giftBalance = s.giftCard?.balance ?? 0;
  return [
    {
      method: 'BANK',
      label: 'ShopSphere Bank (cards, UPI, net banking)',
      enabled: true,
      reason: null,
    },
    { method: 'RAZORPAY', label: 'Razorpay', enabled: false, reason: 'Not configured' },
    {
      method: 'COD',
      label: 'Cash on Delivery',
      enabled: total <= COD_LIMIT,
      reason: total <= COD_LIMIT ? null : 'Not available above ₹50,000',
    },
    {
      method: 'GIFT_CARD',
      label: 'Gift card balance',
      enabled: giftBalance > 0 && giftBalance >= total + (s.giftCard?.applied ?? 0),
      reason: giftBalance > 0 ? 'Balance does not cover the order' : 'Add a gift card first',
    },
  ];
}

function recompute(s: CheckoutSession): CheckoutSession {
  const address = s.addresses.find((a) => a.id === s.addressId);
  const blocked = address?.pincode.startsWith('9') ?? false;
  for (const sh of s.shipments) {
    for (const it of sh.items) it.serviceable = !(blocked && sh.fulfilment === 'SELLER');
    const sum = sh.items.reduce((t, i) => t + i.lineTotal, 0);
    const fresh = options(sh.fulfilment, sum);
    sh.options = fresh;
    if (!fresh.some((o) => o.speed === sh.selected)) sh.selected = 'STANDARD';
  }
  if (
    s.coupon &&
    s.shipments.flatMap((x) => x.items).reduce((t, i) => t + i.lineTotal, 0) < 100_000
  )
    s.coupon = null;
  s.price = priceSession(s);
  s.methods = methods(s, s.price.total);
  if (s.paymentMethod && !s.methods.find((m) => m.method === s.paymentMethod)?.enabled)
    s.paymentMethod = s.price.total === 0 ? 'GIFT_CARD' : 'BANK';
  const unserviceable = s.shipments
    .flatMap((sh) => sh.items)
    .filter((i) => !i.serviceable)
    .map((i) => i.lineId);
  s.issues = unserviceable.length
    ? [
        {
          code: 'NOT_SERVICEABLE',
          message: `Some items can't be delivered to ${address?.pincode}`,
          lineIds: unserviceable,
        },
      ]
    : [];
  return s;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export async function createCheckout(
  source: CheckoutSource,
  opts: { priceChangeOnce?: boolean } = {},
): Promise<CheckoutSession> {
  const store = loadStore();
  const id = `chk-${Date.now().toString(36)}`;
  const shipments =
    source.type === 'CART'
      ? cartShipments()
      : [
          shipment('shp-1', source.sellerId ?? 'seller-ss', 'ShopSphere Retail', 'SHOPSPHERE', [
            item(
              'line-1',
              source.sku,
              source.preview?.slug ?? source.sku,
              source.preview?.title ?? 'Selected item',
              source.preview?.price ?? 99_900,
              source.preview?.mrp ?? source.preview?.price ?? 99_900,
              source.qty,
            ),
          ]),
        ];
  const session = recompute({
    id,
    source: source.type,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    addresses: clone(MOCK_ADDRESSES),
    addressId: MOCK_ADDRESSES.find((a) => a.isDefault)?.id ?? null,
    shipments,
    methods: [],
    paymentMethod: 'BANK',
    coupon: null,
    giftCard: null,
    price: {
      items: 0,
      mrp: 0,
      delivery: 0,
      discount: 0,
      giftCard: 0,
      codFee: 0,
      total: 0,
      savings: 0,
    },
    issues: [],
  });
  store.checkouts[id] = { ...session, priceChangeOnce: opts.priceChangeOnce };
  saveStore(store);
  return clone(session);
}

function getSession(id: string) {
  const store = loadStore();
  const s = store.checkouts[id];
  if (!s) throw err(404, 'CHECKOUT_NOT_FOUND', 'Your checkout session has expired');
  if (Date.parse(s.expiresAt) < Date.now())
    throw err(410, 'CHECKOUT_EXPIRED', 'Your checkout session timed out. Please start again.');
  return { store, s };
}

export async function updateCheckout(id: string, patch: CheckoutPatch): Promise<CheckoutSession> {
  const { store, s } = getSession(id);
  if (patch.newAddress) {
    if (!/^[1-9]\d{5}$/.test(patch.newAddress.pincode))
      throw err(422, 'INVALID_PINCODE', 'Enter a valid 6-digit pincode');
    const a = { ...patch.newAddress, id: `addr-${s.addresses.length + 1}`, isDefault: false };
    s.addresses.push(a);
    s.addressId = a.id;
  }
  if (patch.addressId) {
    if (!s.addresses.some((a) => a.id === patch.addressId))
      throw err(404, 'ADDRESS_NOT_FOUND', 'Address not found');
    s.addressId = patch.addressId;
  }
  if (patch.delivery) {
    const sh = s.shipments.find((x) => x.id === patch.delivery!.shipmentId);
    const opt = sh?.options.find((o) => o.speed === patch.delivery!.speed);
    if (!sh || !opt) throw err(422, 'DELIVERY_UNAVAILABLE', 'That delivery option is unavailable');
    sh.selected = opt.speed;
    sh.slot = opt.speed === 'SCHEDULED' ? (patch.delivery.slot ?? opt.slots[0] ?? null) : null;
  }
  if (patch.removeLineIds?.length) {
    for (const sh of s.shipments)
      sh.items = sh.items.filter((i) => !patch.removeLineIds!.includes(i.lineId));
    s.shipments = s.shipments.filter((sh) => sh.items.length > 0);
  }
  if (patch.couponCode !== undefined) {
    if (patch.couponCode === null) s.coupon = null;
    else {
      const code = patch.couponCode.trim().toUpperCase();
      const items = s.shipments.flatMap((x) => x.items).reduce((t, i) => t + i.lineTotal, 0);
      if (code !== 'SAVE200') throw err(422, 'COUPON_INVALID', `Coupon ${code} is not valid`);
      if (items < 100_000)
        throw err(422, 'COUPON_INVALID', 'SAVE200 needs an order of ₹1,000 or more');
      s.coupon = { code, discount: 20_000 };
    }
  }
  if (patch.giftCardCode !== undefined) {
    const amount = GIFT_CODES[patch.giftCardCode.trim().toUpperCase()];
    if (!amount) throw err(422, 'GIFT_CARD_INVALID', 'Gift card code not recognised');
    const balance = (s.giftCard?.balance ?? 0) + amount;
    s.giftCard = { balance, applied: balance };
  }
  if (patch.useGiftCardBalance !== undefined && s.giftCard)
    s.giftCard.applied = patch.useGiftCardBalance ? s.giftCard.balance : 0;
  if (patch.paymentMethod) s.paymentMethod = patch.paymentMethod;
  if (s.shipments.length === 0) throw err(422, 'CHECKOUT_EMPTY', 'No items left to buy');
  recompute(s);
  saveStore(store);
  return clone(s);
}

export async function placeOrder(id: string, expectedTotal: number): Promise<PlaceOrderResponse> {
  const { store, s } = getSession(id);
  if (s.issues.length) throw err(422, s.issues[0]!.code, s.issues[0]!.message);
  if (s.priceChangeOnce) {
    s.priceChangeOnce = false;
    const line = s.shipments[0]!.items[0]!;
    const from = line.unitPrice;
    line.unitPrice = from + 10_000;
    line.lineTotal = line.unitPrice * line.qty;
    recompute(s);
    saveStore(store);
    return {
      status: 'PRICE_CHANGED',
      changes: [{ lineId: line.lineId, title: line.title, from, to: line.unitPrice }],
      previousTotal: expectedTotal,
      checkout: clone(s),
    };
  }
  if (expectedTotal !== s.price.total)
    return {
      status: 'PRICE_CHANGED',
      changes: [],
      previousTotal: expectedTotal,
      checkout: clone(s),
    };

  const method: PaymentMethod = s.price.total === 0 ? 'GIFT_CARD' : (s.paymentMethod ?? 'BANK');
  const online = method === 'BANK' || method === 'RAZORPAY';
  store.seq += 1;
  const orderId = `ord-${Date.now().toString(36)}`;
  const address = s.addresses.find((a) => a.id === s.addressId)!;
  const now = new Date().toISOString();
  const status = online ? 'PENDING_PAYMENT' : 'CONFIRMED';
  store.orders[orderId] = {
    id: orderId,
    number: `OD${200000 + store.seq}`,
    placedAt: now,
    status,
    total: s.price.total,
    itemCount: s.shipments.flatMap((x) => x.items).reduce((t, i) => t + i.qty, 0),
    deliveryDate:
      s.shipments
        .map((sh) => sh.options.find((o) => o.speed === sh.selected)!.deliveryDate)
        .sort()
        .at(-1) ?? null,
    paymentMethod: method,
    address,
    price: s.price,
    cancellable: true,
    failureReason: null,
    shipments: s.shipments.map((sh) => ({
      id: `${orderId}-${sh.id}`,
      sellerName: sh.sellerName,
      status,
      items: sh.items.map(({ skuId, slug, title, variant, image, qty, unitPrice, lineTotal }) => ({
        skuId,
        slug,
        title,
        variant,
        image,
        qty,
        unitPrice,
        lineTotal,
      })),
      deliveryDate: sh.options.find((o) => o.speed === sh.selected)!.deliveryDate,
      trackingId: null,
      tracking: [{ status, at: now, note: null }],
      invoiceAvailable: false,
    })),
  };
  delete store.checkouts[id];
  saveStore(store);
  return {
    status: 'PLACED',
    orderId,
    orderNumber: store.orders[orderId]!.number,
    paymentRequired: online,
    amount: s.price.total,
  };
}

export async function initiatePayment(
  orderId: string,
  provider: 'bank' | 'razorpay',
  returnUrl: string,
): Promise<InitiatePaymentResponse> {
  const store = loadStore();
  const o = store.orders[orderId];
  if (!o) throw err(404, 'NOT_FOUND', 'Order not found');
  if (provider === 'razorpay') throw err(422, 'PROVIDER_DISABLED', 'Razorpay is not configured');
  if (o.status === 'PAYMENT_FAILED') {
    o.status = 'PENDING_PAYMENT';
    o.failureReason = null;
  }
  if (o.status !== 'PENDING_PAYMENT') throw err(409, 'ORDER_NOT_PAYABLE', 'Order is already paid');
  o.paymentMethod = 'BANK';
  saveStore(store);
  const q = new URLSearchParams({ orderId, amount: String(o.total), returnUrl });
  return {
    paymentId: `pay-${Date.now().toString(36)}`,
    orderId,
    checkout: { kind: 'redirect', url: `/checkout/mock-bank?${q}` },
  };
}

/** What the gateway webhook would do: settle the order. Called by the mock bank page. */
export function settleMockPayment(orderId: string, ok: boolean, reason?: string): void {
  const store = loadStore();
  const o = store.orders[orderId];
  if (!o) return;
  if (ok) setOrderStatus(store, orderId, 'CONFIRMED');
  else {
    setOrderStatus(store, orderId, 'PAYMENT_FAILED', reason);
    o.failureReason = reason ?? 'Payment declined by bank';
    o.cancellable = false;
  }
  saveStore(store);
}

export async function getOrderStatus(orderId: string): Promise<OrderPaymentStatus> {
  const o = loadStore().orders[orderId];
  if (!o) throw err(404, 'NOT_FOUND', 'Order not found');
  const status =
    o.status === 'PAYMENT_FAILED' || o.status === 'PENDING_PAYMENT' || o.status === 'CANCELLED'
      ? o.status
      : 'CONFIRMED';
  const online = o.paymentMethod === 'BANK' || o.paymentMethod === 'RAZORPAY';
  return {
    orderId,
    orderNumber: o.number,
    status,
    paymentState: !online
      ? 'NOT_REQUIRED'
      : status === 'CONFIRMED'
        ? 'PAID'
        : status === 'PAYMENT_FAILED'
          ? 'FAILED'
          : 'PENDING',
    amount: o.total,
    failureReason: o.failureReason ?? null,
    retryUntil:
      status === 'PAYMENT_FAILED'
        ? new Date(Date.parse(o.placedAt) + 15 * 60_000).toISOString()
        : null,
  };
}
