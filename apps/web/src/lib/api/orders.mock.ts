import { ApiRequestError } from '../api';
import type { CheckoutSession } from './checkout.types';
import type {
  OrderDetail,
  OrderStatus,
  OrdersPage,
  OrdersQuery,
  OrderSummary,
  TrackingEvent,
} from './orders.types';

/**
 * In-browser order store for NEXT_PUBLIC_CHECKOUT_MOCK=1. Persisted in localStorage so the flow
 * survives the full-page hop to the (mock) bank and back. Seeded with two historical orders.
 */

const KEY = 'ss_mock_orders_v1';

export interface MockStore {
  checkouts: Record<string, CheckoutSession & { priceChangeOnce?: boolean }>;
  orders: Record<string, OrderDetail & { failureReason?: string | null }>;
  seq: number;
}

const day = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();
const date = (t: number) => iso(t).slice(0, 10);

const ADDRESS = {
  id: 'addr-home',
  name: 'Asha Verma',
  phone: '+919876543210',
  line1: '12, MG Road',
  line2: 'Indiranagar',
  landmark: 'Near metro station',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560038',
  type: 'HOME' as const,
  isDefault: true,
};
export const MOCK_ADDRESSES = [
  ADDRESS,
  {
    ...ADDRESS,
    id: 'addr-work',
    line1: '4th Floor, Tower B',
    line2: 'Cyber City',
    landmark: null,
    city: 'Gurugram',
    state: 'Haryana',
    pincode: '122002',
    type: 'WORK' as const,
    isDefault: false,
  },
];

function seedOrder(n: number, status: OrderStatus, placedDaysAgo: number): OrderDetail {
  const placed = Date.now() - placedDaysAgo * day;
  const flow: OrderStatus[] = ['CONFIRMED', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  const upTo = status === 'CANCELLED' ? 1 : flow.indexOf(status) + 1;
  const tracking: TrackingEvent[] = flow
    .slice(0, upTo)
    .map((s, i) => ({ status: s, at: iso(placed + i * day), note: null }));
  if (status === 'CANCELLED')
    tracking.push({ status: 'CANCELLED', at: iso(placed + day / 2), note: 'Cancelled by you' });
  const item = {
    skuId: `sku-seed-${n}`,
    slug: n === 1 ? 'boat-rockerz-450' : 'prestige-kettle-1-5l',
    title: n === 1 ? 'boAt Rockerz 450 Bluetooth Headphones' : 'Prestige 1.5 L Electric Kettle',
    variant: {},
    image: null,
    qty: 1,
    unitPrice: n === 1 ? 149900 : 79900,
    lineTotal: n === 1 ? 149900 : 79900,
  };
  return {
    id: `ord-seed-${n}`,
    number: `OD10000${n}`,
    placedAt: iso(placed),
    status,
    total: item.lineTotal,
    itemCount: 1,
    deliveryDate: date(placed + 4 * day),
    paymentMethod: 'BANK',
    address: ADDRESS,
    price: {
      items: item.lineTotal,
      mrp: item.lineTotal + 50000,
      delivery: 0,
      discount: 0,
      giftCard: 0,
      codFee: 0,
      total: item.lineTotal,
      savings: 50000,
    },
    shipments: [
      {
        id: `shp-seed-${n}`,
        sellerName: 'ShopSphere Retail',
        status,
        items: [item],
        deliveryDate: date(placed + 4 * day),
        trackingId: status === 'CANCELLED' ? null : `SSX${n}00042`,
        tracking,
        invoiceAvailable: status !== 'CANCELLED',
      },
    ],
    cancellable: false,
  };
}

function seed(): MockStore {
  const a = seedOrder(1, 'DELIVERED', 400);
  const b = seedOrder(2, 'CANCELLED', 30);
  return { checkouts: {}, orders: { [a.id]: a, [b.id]: b }, seq: 2 };
}

let memory: MockStore | null = null;

export function loadStore(): MockStore {
  if (typeof localStorage === 'undefined') return (memory ??= seed());
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockStore;
  } catch {
    // corrupted / blocked storage: start over
  }
  const s = seed();
  saveStore(s);
  return s;
}

export function saveStore(s: MockStore): void {
  memory = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: in-memory only
  }
}

export function resetMockStore(): void {
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

const notFound = () =>
  new ApiRequestError(404, { code: 'NOT_FOUND', message: 'Order not found', details: null });

const CANCELLABLE: OrderStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'];

export function setOrderStatus(s: MockStore, id: string, status: OrderStatus, note?: string) {
  const o = s.orders[id];
  if (!o) throw notFound();
  o.status = status;
  o.cancellable = CANCELLABLE.includes(status);
  for (const sh of o.shipments) {
    sh.status = status;
    sh.tracking.push({ status, at: new Date().toISOString(), note: note ?? null });
  }
}

const summary = (o: OrderDetail): OrderSummary => ({
  id: o.id,
  number: o.number,
  placedAt: o.placedAt,
  status: o.status,
  total: o.total,
  itemCount: o.itemCount,
  deliveryDate: o.deliveryDate,
  items: o.shipments
    .flatMap((s) => s.items)
    .map(({ title, image, slug }) => ({ title, image, slug })),
});

const ACTIVE: OrderStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
];

export async function listOrders(q: OrdersQuery): Promise<OrdersPage> {
  const all = Object.values(loadStore().orders).sort((a, b) =>
    b.placedAt.localeCompare(a.placedAt),
  );
  const years = [...new Set(all.map((o) => new Date(o.placedAt).getUTCFullYear()))];
  const filtered = all.filter((o) => {
    if (q.year && new Date(o.placedAt).getUTCFullYear() !== q.year) return false;
    if (q.status === 'ACTIVE') return ACTIVE.includes(o.status);
    if (q.status === 'DELIVERED') return o.status === 'DELIVERED';
    if (q.status === 'CANCELLED') return o.status === 'CANCELLED' || o.status === 'PAYMENT_FAILED';
    return true;
  });
  return {
    orders: filtered.map(summary),
    years,
    total: filtered.length,
    page: 1,
    pageSize: 50,
  };
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  return loadStore().orders[id] ?? null;
}

export async function cancelOrder(id: string, reason: string): Promise<OrderDetail> {
  const s = loadStore();
  const o = s.orders[id];
  if (!o) throw notFound();
  if (!o.cancellable)
    throw new ApiRequestError(409, {
      code: 'NOT_CANCELLABLE',
      message: 'This order can no longer be cancelled',
      details: null,
    });
  setOrderStatus(s, id, 'CANCELLED', reason);
  saveStore(s);
  return o;
}
