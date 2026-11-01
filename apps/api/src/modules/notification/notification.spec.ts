import type Redis from 'ioredis';
import type { ProcessedEventsService } from '../shared/events/processed-events.service';
import type { PrismaService } from '../shared/prisma/prisma.service';
import type { NotificationChannels } from './channels';
import type { WebPushService } from './web-push.service';
import { loadNotificationConfig } from './notification.config';
import { NotificationService } from './notification.service';
import { PreferencesStore } from './preferences';
import { inr, renderNotification, type NotificationEvent } from './templates';

/** Just the hash commands PreferencesStore uses. */
class HashRedis {
  private data = new Map<string, Record<string, string>>();
  async hgetall(key: string) {
    return { ...(this.data.get(key) ?? {}) };
  }
  async hset(key: string, fields: Record<string, string>) {
    this.data.set(key, { ...(this.data.get(key) ?? {}), ...fields });
    return Object.keys(fields).length;
  }
}

const to = { name: 'Asha Verma', email: 'asha@example.test', phone: '+919876543210' };
const ctx = { itemTitles: ['Redmi Note 13 5G', 'Case'], deliveryDate: '2026-11-04' };
const base = {
  orderId: 'ord-1',
  orderNumber: 'OD200001',
  userId: 'u1',
  occurredAt: '2026-10-31T10:00:00.000Z',
};
const tax = { rateBp: 1800, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
const item = (title: string, qty: number) => ({
  orderItemId: title,
  skuId: title,
  title,
  qty,
  unitPricePaise: 100,
  lineTotalPaise: 100 * qty,
  discountPaise: 0,
  tax,
});

const confirmed: NotificationEvent = {
  id: 'evt-1',
  type: 'order.confirmed',
  payload: {
    ...base,
    status: 'CONFIRMED',
    paymentMethod: 'ONLINE',
    totalPaise: 1_839_800,
    payablePaise: 1_839_800,
    lateCapture: false,
    shipments: [
      {
        shipmentId: 's1',
        sellerId: 'x',
        sellerName: 'A',
        sellerState: 'Karnataka',
        shipToState: 'Karnataka',
        promisedDate: '2026-11-04',
        items: [item('Redmi Note 13 5G', 1)],
      },
      {
        shipmentId: 's2',
        sellerId: 'y',
        sellerName: 'B',
        sellerState: 'Maharashtra',
        shipToState: 'Karnataka',
        promisedDate: '2026-11-05',
        items: [item('Milton Flask', 2)],
      },
    ],
  },
};
const failed: NotificationEvent = {
  id: 'evt-2',
  type: 'order.payment_failed',
  payload: {
    ...base,
    status: 'PENDING_PAYMENT',
    reason: 'Card declined',
    provider: 'bank',
    retryUntil: '2026-10-31T10:15:00.000Z',
  },
};
const shipped: NotificationEvent = {
  id: 'evt-3',
  type: 'order.shipped',
  payload: {
    ...base,
    status: 'SHIPPED',
    fromStatus: 'PACKED',
    shipmentId: 'shp-1',
    courier: 'courier-sim',
    awb: 'SSL123456',
  },
};
const delivered: NotificationEvent = {
  id: 'evt-4',
  type: 'order.delivered',
  payload: {
    ...base,
    status: 'DELIVERED',
    fromStatus: 'SHIPPED',
    shipmentId: 'shp-1',
    courier: 'courier-sim',
    awb: 'SSL123456',
  },
};
const packed: NotificationEvent = {
  id: 'evt-5',
  type: 'order.status_changed',
  payload: { ...base, status: 'PACKED', fromStatus: 'CONFIRMED' },
};
const noStock: NotificationEvent = {
  id: 'evt-6',
  type: 'order.cancelled',
  payload: {
    ...base,
    status: 'CANCELLED_NO_STOCK',
    reason: 'late capture',
    cancelledBy: 'system',
    refunds: [{ destination: 'GATEWAY', amountPaise: 1_839_800 }],
  },
};
const WEB = 'http://localhost:3000';
const render = (e: NotificationEvent) => renderNotification(e, to, ctx, WEB)!;

describe('templates', () => {
  it('formats rupees Indian-style', () => {
    expect(inr(1_839_800)).toBe('₹18,398');
    expect(inr(12_345_650)).toBe('₹1,23,456.50');
  });

  it.each([confirmed, failed, shipped, delivered, noStock])(
    '$id: email + SMS under 160 chars',
    (e) => {
      const r = render(e);
      expect(r.email.subject).toContain(
        e.type === 'order.shipped' || e.type === 'order.delivered' ? 'Redmi' : 'OD200001',
      );
      expect(r.email.text).toContain(`${WEB}/orders/ord-1`);
      expect(r.email.text.startsWith('Hi Asha,')).toBe(true);
      expect(r.sms.length).toBeLessThanOrEqual(160);
    },
  );

  it('order placed lists items, total and the latest delivery date', () => {
    const r = render(confirmed);
    expect(r.category).toBe('ORDER_UPDATES');
    expect(r.emailMandatory).toBe(true);
    expect(r.email.text).toContain('Milton Flask × 2');
    expect(r.email.text).toContain('Order total: ₹18,398 (paid)');
    expect(r.email.text).toMatch(/Arriving by .*5 Nov/);
    expect(r.email.text).toContain('Ships in 2 packages');
  });

  it('payment failed is a payment alert with the reason and retry window', () => {
    const r = render(failed);
    expect(r.category).toBe('PAYMENT_ALERTS');
    expect(r.email.text).toContain('(Card declined)');
    expect(r.sms).toContain('Retry soon');
  });

  it('shipped/delivered carry carrier + AWB; other transitions send nothing', () => {
    expect(render(shipped).email.subject).toBe('Shipped: Redmi Note 13 5G and 1 more');
    expect(render(shipped).email.text).toContain('ShopSphere Logistics AWB SSL123456');
    expect(render(shipped).sms).toContain('AWB SSL123456');
    expect(render(delivered).email.text).toContain('AWB SSL123456');
    expect(render(delivered).email.subject).toBe('Delivered: Redmi Note 13 5G and 1 more');
    expect(renderNotification(packed, to, ctx, WEB)).toBeNull();
  });

  it('late capture with no stock sends a mandatory apology with the refund', () => {
    const r = render(noStock);
    expect(r.emailMandatory).toBe(true);
    expect(r.email.subject).toContain('Sorry');
    expect(r.email.text).toContain('refund of ₹18,398');
  });

  it('return requested / picked up / refunded (M6.1) render, with a WhatsApp text', () => {
    const ev = (status: string, extra: object) =>
      ({
        id: `evt-r-${status}`,
        type: 'order.status_changed',
        payload: { ...base, status, fromStatus: 'DELIVERED', ...extra },
      }) as unknown as NotificationEvent;
    const requested = render(ev('RETURN_REQUESTED', { pickupDate: '2026-11-05' }));
    expect(requested.email.subject).toBe('Return requested: Redmi Note 13 5G and 1 more');
    expect(requested.sms).toMatch(/Pickup on .*5 Nov/);
    expect(requested.whatsapp.startsWith('*Return requested')).toBe(true);
    expect(render(ev('PICKED_UP', {})).sms).toContain('picked up');
    const refunded = render(
      ev('REFUNDED', {
        refundTo: 'STORE_BALANCE',
        refunds: [{ destination: 'STORE_BALANCE', amountPaise: 1_839_800 }],
      }),
    );
    expect(refunded.emailMandatory).toBe(true);
    expect(refunded.email.subject).toBe('Refund of ₹18,398 issued for order OD200001');
    expect(refunded.sms).toContain('ShopSphere Pay balance');
    expect(refunded.sms.length).toBeLessThanOrEqual(160);
  });
});

function setup(phoneless = false) {
  const sent: string[] = [];
  const channels: NotificationChannels = {
    email: async (to, subject) => void sent.push(`email:${to}:${subject}`),
    sms: async (to) => void sent.push(`sms:${to}`),
    whatsapp: async (to) => void sent.push(`whatsapp:${to}`),
  };
  const pushed: string[] = [];
  const subscribed = new Set<string>();
  const push = {
    send: async (userId: string, msg: { title: string }) => {
      if (!subscribed.has(userId)) return 0;
      pushed.push(`${userId}:${msg.title}`);
      return 1;
    },
  } as unknown as WebPushService;
  const done = new Set<string>();
  const processed = {
    runOnce: async (consumer: string, id: string, handler: () => Promise<void>) => {
      if (done.has(`${consumer}:${id}`)) return false;
      await handler();
      done.add(`${consumer}:${id}`);
      return true;
    },
  } as unknown as ProcessedEventsService;
  const prefs = new PreferencesStore(new HashRedis() as unknown as Redis);
  const directory = {
    recipient: async () => ({ ...to, phone: phoneless ? null : to.phone }),
    order: async () => ctx,
  };
  const service = new NotificationService(
    channels,
    loadNotificationConfig({}),
    prefs,
    processed,
    {} as PrismaService,
    directory,
    push,
  );
  return { service, sent, prefs, pushed, subscribed };
}

describe('NotificationService.dispatch', () => {
  it('sends email + SMS once per event id', async () => {
    const { service, sent } = setup();
    expect(await service.dispatch(shipped)).toEqual({ processed: true, sent: ['email', 'sms'] });
    expect(await service.dispatch(shipped)).toEqual({ processed: false, sent: [] });
    expect(sent).toHaveLength(2);
  });

  it('respects channel preferences per category', async () => {
    const { service, prefs } = setup();
    await prefs.update('u1', { ORDER_UPDATES: { email: false, sms: false } });
    expect((await service.dispatch(shipped)).sent).toEqual([]);
    expect((await service.dispatch(failed)).sent).toEqual(['email', 'sms']);
  });

  it('always emails the order confirmation (receipt) even with email off', async () => {
    const { service, prefs } = setup();
    await prefs.update('u1', { ORDER_UPDATES: { email: false } });
    expect((await service.dispatch(confirmed)).sent).toEqual(['email', 'sms']);
  });

  it('skips channels the recipient has no address for', async () => {
    const { service } = setup(true);
    expect((await service.dispatch(delivered)).sent).toEqual(['email']);
  });

  it('sends nothing for transitions without a template', async () => {
    const { service } = setup();
    expect(await service.dispatch(packed)).toEqual({ processed: true, sent: [] });
  });

  it('sends WhatsApp only when opted in, and web push to subscribed browsers', async () => {
    const { service, prefs, sent, pushed, subscribed } = setup();
    await prefs.update('u1', { ORDER_UPDATES: { whatsapp: true } });
    subscribed.add('u1');
    expect((await service.dispatch(shipped)).sent).toEqual(['email', 'sms', 'whatsapp', 'push']);
    expect(sent).toContain('whatsapp:+919876543210');
    expect(pushed).toEqual(['u1:Shipped: Redmi Note 13 5G and 1 more']);
    await prefs.update('u1', { ORDER_UPDATES: { push: false } });
    expect((await service.dispatch(delivered)).sent).toEqual(['email', 'sms', 'whatsapp']);
  });

  it('propagates send failures so the worker retries', async () => {
    const { service } = setup();
    (service as unknown as { channels: NotificationChannels }).channels.sms = async () => {
      throw new Error('smtp down');
    };
    await expect(service.dispatch(failed)).rejects.toThrow('smtp down');
  });
});

describe('PreferencesStore', () => {
  it('defaults everything on and merges partial updates', async () => {
    const prefs = new PreferencesStore(new HashRedis() as unknown as Redis);
    expect(await prefs.get('u2')).toEqual({
      ORDER_UPDATES: { email: true, sms: true, whatsapp: false, push: true },
      PAYMENT_ALERTS: { email: true, sms: true, whatsapp: false, push: true },
    });
    expect(
      await prefs.update('u2', {
        PAYMENT_ALERTS: { sms: false },
        ORDER_UPDATES: { whatsapp: true },
      }),
    ).toEqual({
      ORDER_UPDATES: { email: true, sms: true, whatsapp: true, push: true },
      PAYMENT_ALERTS: { email: true, sms: false, whatsapp: false, push: true },
    });
  });
});
