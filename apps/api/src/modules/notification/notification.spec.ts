import type Redis from 'ioredis';
import type { ProcessedEventsService } from '../shared/events/processed-events.service';
import type { PrismaService } from '../shared/prisma/prisma.service';
import type { NotificationChannels } from './channels';
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

const recipient = {
  userId: 'u1',
  name: 'Asha Verma',
  email: 'asha@example.test',
  phone: '+919876543210',
};
const base = { orderId: 'ord-1', orderNumber: 'OD200001', recipient };

const confirmed: NotificationEvent = {
  id: 'evt-1',
  type: 'order.confirmed',
  payload: {
    ...base,
    total: 1_839_800,
    paymentMethod: 'BANK',
    shipments: [
      { items: [{ title: 'Redmi Note 13 5G', qty: 1 }], deliveryDate: '2026-11-04' },
      { items: [{ title: 'Milton Flask', qty: 2 }], deliveryDate: '2026-11-05' },
    ],
  },
};
const failed: NotificationEvent = {
  id: 'evt-2',
  type: 'payment.failed',
  payload: { ...base, amount: 1_839_800, reason: 'Card declined' },
};
const shipped: NotificationEvent = {
  id: 'evt-3',
  type: 'order.shipped',
  payload: {
    ...base,
    itemTitles: ['Redmi Note 13 5G', 'Case'],
    trackingId: 'SSX123',
    carrier: 'ShopSphere Logistics',
    deliveryDate: '2026-11-04',
  },
};
const delivered: NotificationEvent = {
  id: 'evt-4',
  type: 'order.delivered',
  payload: { ...base, itemTitles: ['Redmi Note 13 5G'] },
};
const WEB = 'http://localhost:3000';

describe('templates', () => {
  it('formats rupees Indian-style', () => {
    expect(inr(1_839_800)).toBe('₹18,398');
    expect(inr(12_345_650)).toBe('₹1,23,456.50');
  });

  it.each([confirmed, failed, shipped, delivered])('$type: email + SMS under 160 chars', (e) => {
    const r = renderNotification(e, WEB);
    expect(r.email.subject).toContain(
      e.type === 'order.shipped' || e.type === 'order.delivered' ? 'Redmi' : 'OD200001',
    );
    expect(r.email.text).toContain(`${WEB}/orders/ord-1`);
    expect(r.email.text.startsWith('Hi Asha,')).toBe(true);
    expect(r.sms.length).toBeLessThanOrEqual(160);
  });

  it('order placed lists items, total and the latest delivery date', () => {
    const r = renderNotification(confirmed, WEB);
    expect(r.category).toBe('ORDER_UPDATES');
    expect(r.emailMandatory).toBe(true);
    expect(r.email.text).toContain('Milton Flask × 2');
    expect(r.email.text).toContain('Order total: ₹18,398 (paid)');
    expect(r.email.text).toMatch(/Arriving by .*5 Nov/);
    expect(r.email.text).toContain('Ships in 2 packages');
  });

  it('payment failed is a payment alert with the reason and retry window', () => {
    const r = renderNotification(failed, WEB);
    expect(r.category).toBe('PAYMENT_ALERTS');
    expect(r.email.text).toContain('(Card declined)');
    expect(r.sms).toContain('Retry within 15 min');
  });

  it('shipped mentions carrier tracking', () => {
    expect(renderNotification(shipped, WEB).email.text).toContain(
      'ShopSphere Logistics tracking ID SSX123',
    );
    expect(renderNotification(shipped, WEB).email.subject).toBe(
      'Shipped: Redmi Note 13 5G and 1 more',
    );
  });
});

function setup() {
  const sent: string[] = [];
  const channels: NotificationChannels = {
    email: async (to, subject) => void sent.push(`email:${to}:${subject}`),
    sms: async (to) => void sent.push(`sms:${to}`),
  };
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
  const service = new NotificationService(
    channels,
    loadNotificationConfig({}),
    prefs,
    processed,
    {} as PrismaService,
  );
  return { service, sent, prefs };
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
    const { service } = setup();
    const noPhone = {
      ...delivered,
      id: 'evt-9',
      payload: { ...delivered.payload, recipient: { ...recipient, phone: null } },
    } as NotificationEvent;
    expect((await service.dispatch(noPhone)).sent).toEqual(['email']);
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
      ORDER_UPDATES: { email: true, sms: true },
      PAYMENT_ALERTS: { email: true, sms: true },
    });
    expect(await prefs.update('u2', { PAYMENT_ALERTS: { sms: false } })).toEqual({
      ORDER_UPDATES: { email: true, sms: true },
      PAYMENT_ALERTS: { email: true, sms: false },
    });
  });
});
