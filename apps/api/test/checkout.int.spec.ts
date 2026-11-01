/**
 * Checkout → order → payment integration tests against a real Postgres (row locks, unique keys
 * and CHECK constraints are the point). Redis is faked; the bank gateway is the real BankProvider
 * crypto with a fake network, so webhooks are signed exactly as in production.
 * Run with `pnpm --filter @shopsphere/api test:int` (DATABASE_URL migrated with `prisma migrate deploy`).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CategoryTreeService } from '../src/modules/catalog/category-tree.service';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { InvoiceStore } from '../src/modules/order/invoice.store';
import { OrderWorker } from '../src/modules/order/order.worker';
import { PaymentEventsConsumer } from '../src/modules/order/payment-events.consumer';
import { BankProvider } from '../src/modules/payment/providers/bank.provider';
import type { GatewayOrder } from '../src/modules/payment/providers/payment-provider';
import { ProviderRegistry } from '../src/modules/payment/providers/provider.registry';
import { hmacSha256Hex } from '../src/modules/payment/providers/signature';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m4_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.PLACE_ORDER_RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';

const WEBHOOK_SECRET = 'ssb_test_webhook_secret';
const run = Date.now().toString(36);
const RETURN_URL = 'http://localhost:3000/checkout/result';

class FakeBank extends BankProvider {
  orders = 0;
  refunds: { paymentId: string; amount: bigint }[] = [];
  constructor() {
    super(
      {
        apiBaseUrl: 'http://bank.invalid/v1',
        keyId: 'ssb_test_key_id',
        keySecret: 'ssb_test_key_secret',
        webhookSecret: WEBHOOK_SECRET,
        signatureHeader: 'x-bank-signature',
        eventIdHeader: 'x-bank-event-id',
      },
      'http://bank.invalid/checkout',
    );
  }
  async createOrder(input: { amountPaise: bigint; currency: string }): Promise<GatewayOrder> {
    this.orders += 1;
    return {
      providerOrderId: `order_${run}_${this.orders}`,
      amountPaise: input.amountPaise,
      currency: input.currency,
    };
  }
  async refund(paymentId: string, amount: bigint) {
    this.refunds.push({ paymentId, amount });
    return { providerRefundId: `rfnd_${run}_${this.refunds.length}`, status: 'processed' as const };
  }
  async fetchStatus() {
    return [];
  }
  async capture() {}
}

describe('checkout, orders and payments (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let consumer: PaymentEventsConsumer;
  let worker: OrderWorker;
  let ledger: LedgerService;
  const bank = new FakeBank();
  let catId: string;
  let brandId: string;
  let sellerKA: string;
  let sellerMH: string;
  let n = 0;

  let baseUrl: string;
  // One listening server: per-request ephemeral listeners reset under heavy concurrency.
  const http = () => request(baseUrl);

  async function newUser() {
    const user = await prisma.user.create({ data: { name: 'Checkout Tester' } });
    const tokens = await sessions.create(user.id, false, {});
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        name: 'Asha',
        phone: '+919876543210',
        line1: '12 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
        isDefault: true,
      },
    });
    return { id: user.id, auth: `Bearer ${tokens.accessToken}`, addressId: address.id };
  }

  async function newOffer(opts: { stock: number; price?: number; seller?: string }) {
    n += 1;
    const product = await prisma.product.create({
      data: {
        slug: `m4-${run}-${n}`,
        title: `M4 Product ${n}`,
        brandId,
        categoryId: catId,
        skus: { create: { code: `M4-${run}-${n}`, isDefault: true } },
      },
      include: { skus: true },
    });
    const sku = product.skus[0];
    const offer = await prisma.offer.create({
      data: {
        skuId: sku.id,
        sellerId: opts.seller ?? sellerKA,
        price: BigInt(opts.price ?? 118_000),
        mrp: BigInt((opts.price ?? 118_000) + 20_000),
        stockQty: opts.stock,
        maxPerOrder: 10,
      },
    });
    return { skuId: sku.id, offerId: offer.id, productId: product.id };
  }

  const offerRow = (id: string) => prisma.offer.findUniqueOrThrow({ where: { id } });
  const orderRow = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

  async function buyNow(
    user: { auth: string },
    skuId: string,
    method: { type: 'COD' } | { type: 'ONLINE'; provider: 'bank' },
    qty = 1,
    extra: Record<string, unknown> = {},
  ) {
    const created = await http()
      .post('/checkout')
      .set('authorization', user.auth)
      .send({ source: 'BUY_NOW', skuId, qty });
    expect(created.status).toBe(201);
    const patched = await http()
      .patch(`/checkout/${created.body.id}`)
      .set('authorization', user.auth)
      .send({ paymentMethod: method, ...extra });
    expect(patched.status).toBe(200);
    return patched.body as {
      id: string;
      totals: { totalPaise: number; payablePaise: number };
      issues: unknown[];
    };
  }

  function place(
    user: { auth: string },
    session: { id: string; totals: { totalPaise: number } },
    key = `k-${Math.random()}`,
  ) {
    return http()
      .post(`/checkout/${session.id}/place-order`)
      .set('authorization', user.auth)
      .set('idempotency-key', key)
      .send({ expectedTotalPaise: session.totals.totalPaise });
  }

  async function initiate(user: { auth: string }, orderId: string) {
    const res = await http()
      .post(`/payments/${orderId}/initiate`)
      .set('authorization', user.auth)
      .set('idempotency-key', `init-${Math.random()}`)
      .send({ provider: 'bank', returnUrl: RETURN_URL });
    expect(res.status).toBe(201);
    return res.body as { providerOrderId: string; amountPaise: number };
  }

  function webhook(
    event: string,
    p: { id: string; orderId: string; amount: number },
    eventId: string,
    secret = WEBHOOK_SECRET,
  ) {
    const body = Buffer.from(
      JSON.stringify({
        event,
        payload: {
          payment: {
            entity: {
              id: p.id,
              order_id: p.orderId,
              amount: p.amount,
              currency: 'INR',
              status: event.split('.')[1],
              method: 'upi',
              error_description: event === 'payment.failed' ? 'Declined by bank' : null,
            },
          },
        },
      }),
    );
    return http()
      .post('/payments/webhooks/bank')
      .set('content-type', 'application/json')
      .set('x-bank-signature', hmacSha256Hex(secret, body))
      .set('x-bank-event-id', eventId)
      .send(body.toString());
  }

  const outbox = (orderId: string) =>
    prisma.outboxEvent.findMany({
      where: { aggregateId: orderId, aggregateType: 'order' },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);
    consumer = app.get(PaymentEventsConsumer);
    worker = app.get(OrderWorker);
    ledger = app.get(LedgerService);
    app.get(ProviderRegistry).register(bank);

    const cat = await prisma.category.create({
      data: { slug: `m4-${run}`, name: 'M4 test', path: `m4-${run}`, gstRateBp: 1800 },
    });
    catId = cat.id;
    app.get(CategoryTreeService).invalidate();
    brandId = (await prisma.brand.create({ data: { slug: `m4-brand-${run}`, name: 'M4 Brand' } }))
      .id;
    const seller = (slug: string, state: string, pincode: string) =>
      prisma.seller.create({
        data: { name: `Seller ${slug}`, slug: `m4-${slug}-${run}`, pincode, city: 'X', state },
      });
    sellerKA = (await seller('ka', 'Karnataka', '560001')).id;
    sellerMH = (await seller('mh', 'Maharashtra', '400001')).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('splits shipments per seller and GST into CGST+SGST (same state) vs IGST', async () => {
    const user = await newUser();
    const a = await newOffer({ stock: 5, seller: sellerKA });
    const b = await newOffer({ stock: 5, seller: sellerMH });
    for (const p of [a, b]) {
      const r = await http()
        .post('/cart/items')
        .set('authorization', user.auth)
        .set('content-type', 'application/json')
        .send({ sku: p.skuId, qty: 1 });
      expect(r.status).toBe(201);
    }
    const res = await http()
      .post('/checkout')
      .set('authorization', user.auth)
      .send({ source: 'CART' });
    expect(res.status).toBe(201);
    const s = res.body;
    expect(s.shipments).toHaveLength(2);
    const ka = s.shipments.find((x: { sellerId: string }) => x.sellerId === sellerKA).lines[0].tax;
    const mh = s.shipments.find((x: { sellerId: string }) => x.sellerId === sellerMH).lines[0].tax;
    expect(ka).toEqual({
      rateBp: 1800,
      taxablePaise: 100_000,
      cgstPaise: 9_000,
      sgstPaise: 9_000,
      igstPaise: 0,
    });
    expect(mh).toEqual({
      rateBp: 1800,
      taxablePaise: 100_000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 18_000,
    });
    expect(s.totals.tax).toEqual({
      cgstPaise: 9_000,
      sgstPaise: 9_000,
      igstPaise: 18_000,
      totalPaise: 36_000,
    });
    expect(s.totals.itemsPaise).toBe(236_000);
  });

  it('COD confirms at place-order: stock deducted, cart cleared, order.confirmed emitted', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 3 });
    await http()
      .post('/cart/items')
      .set('authorization', user.auth)
      .set('content-type', 'application/json')
      .send({ sku: p.skuId, qty: 2 });
    const created = await http()
      .post('/checkout')
      .set('authorization', user.auth)
      .send({ source: 'CART' });
    const s = (
      await http()
        .patch(`/checkout/${created.body.id}`)
        .set('authorization', user.auth)
        .send({ paymentMethod: { type: 'COD' } })
    ).body;
    expect(s.totals.codFeePaise).toBe(1_000);
    const res = await place(user, s);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'CONFIRMED', next: { type: 'CONFIRMED' } });
    const offer = await offerRow(p.offerId);
    expect([offer.stockQty, offer.reservedQty]).toEqual([1, 0]);
    expect(
      await prisma.cartItem.count({ where: { cart: { userId: user.id }, skuId: p.skuId } }),
    ).toBe(0);
    expect((await outbox(res.body.orderId)).map((e) => e.eventType)).toEqual([
      'order.placed',
      'order.confirmed',
    ]);
    const detail = await http().get(`/orders/${res.body.orderId}`).set('authorization', user.auth);
    expect(detail.body).toMatchObject({
      status: 'CONFIRMED',
      payment: { method: 'COD', state: 'COD' },
      canCancel: true,
    });
  });

  it('place-order is idempotent: same key, double click, two tabs → one order, one reservation', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 5 });
    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const [r1, r2, r3] = await Promise.all([
      place(user, s, 'same-key'),
      place(user, s, 'same-key'),
      place(user, s, 'other-tab'),
    ]);
    const ok = [r1, r2, r3].filter((r) => r.status === 201);
    expect(new Set(ok.map((r) => r.body.orderId)).size).toBe(1);
    // Retry after the fact with the same key replays the same order.
    const again = await place(user, s, 'same-key');
    expect(again.body.orderId).toBe(ok[0].body.orderId);
    expect(await prisma.order.count({ where: { checkoutId: s.id } })).toBe(1);
    expect((await offerRow(p.offerId)).reservedQty).toBe(1);
    expect(again.body.next).toMatchObject({ type: 'PAY', amountPaise: s.totals.payablePaise });
  });

  it('refuses a stale total with PRICE_CHANGED and creates nothing', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 5 });
    const s = await buyNow(user, p.skuId, { type: 'COD' });
    await prisma.offer.update({
      where: { id: p.offerId },
      data: { price: 120_000n, mrp: 150_000n },
    });
    const res = await place(user, s);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.details.totalPaise).toBeGreaterThan(s.totals.totalPaise);
    expect(await prisma.order.count({ where: { checkoutId: s.id } })).toBe(0);
    expect(
      await place(user, { id: s.id, totals: { totalPaise: res.body.details.totalPaise } }).then(
        (r) => r.status,
      ),
    ).toBe(201);
  });

  it('reservation expiry releases stock, order PAYMENT_FAILED, cart untouched', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 2 });
    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const { orderId } = (await place(user, s)).body;
    expect((await offerRow(p.offerId)).reservedQty).toBe(1);
    // Not due yet: nothing happens.
    await worker.sweep();
    expect((await orderRow(orderId)).status).toBe('PENDING_PAYMENT');
    await prisma.order.update({
      where: { id: orderId },
      data: { payBy: new Date(Date.now() - 1000) },
    });
    const r = await worker.sweep();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await orderRow(orderId)).status).toBe('PAYMENT_FAILED');
    expect(await offerRow(p.offerId)).toMatchObject({ stockQty: 2, reservedQty: 0 });
    expect((await outbox(orderId)).map((e) => e.eventType)).toContain('order.payment_expired');
    // No new payments on a closed window.
    const init = await http()
      .post(`/payments/${orderId}/initiate`)
      .set('authorization', user.auth)
      .set('idempotency-key', 'late')
      .send({ provider: 'bank', returnUrl: RETURN_URL });
    expect(init.body.code).toBe('ORDER_NOT_PAYABLE');
  });

  it('a pending payment extends the window to 30 minutes (M4.35)', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 2 });
    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const { orderId } = (await place(user, s)).body;
    const pending = await http()
      .post(`/orders/${orderId}/test-payment`)
      .set('authorization', user.auth)
      .send({ outcome: 'pending' });
    expect(pending.status).toBe(200);
    await prisma.order.update({
      where: { id: orderId },
      data: { payBy: new Date(Date.now() - 1000) },
    });
    await worker.sweep();
    const o = await orderRow(orderId);
    expect(o.status).toBe('PENDING_PAYMENT');
    expect(o.payBy!.getTime()).toBe(o.placedAt.getTime() + 30 * 60_000);
    const res = await prisma.inventoryReservation.findFirstOrThrow({ where: { orderId } });
    expect(res.expiresAt.getTime()).toBe(o.payBy!.getTime());
  });

  it('webhook capture confirms; replay, out-of-order failure and tampering change nothing', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 3 });
    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const { orderId } = (await place(user, s)).body;
    const gw = await initiate(user, orderId);

    const tampered = await webhook(
      'payment.captured',
      { id: `pay_${run}_t`, orderId: gw.providerOrderId, amount: gw.amountPaise },
      `evt_${run}_t`,
      'wrong-secret',
    );
    expect(tampered.status).toBe(401);

    const pay = {
      id: `pay_${run}_${orderId.slice(0, 8)}`,
      orderId: gw.providerOrderId,
      amount: gw.amountPaise,
    };
    expect((await webhook('payment.captured', pay, `evt_${orderId}_1`)).body.outcome).toBe(
      'CAPTURED',
    );
    expect((await webhook('payment.captured', pay, `evt_${orderId}_1`)).body.outcome).toBe(
      'DUPLICATE_EVENT',
    );
    // Same capture re-sent under a new event id (gateway retry) is already applied.
    expect((await webhook('payment.captured', pay, `evt_${orderId}_2`)).body.outcome).toBe(
      'ALREADY_APPLIED',
    );
    // A failure for the same payment arriving late must not undo the capture.
    expect((await webhook('payment.failed', pay, `evt_${orderId}_3`)).body.outcome).toBe(
      'IGNORED_STALE',
    );

    await consumer.drain();
    await consumer.drain(); // idempotent consumer
    expect((await orderRow(orderId)).status).toBe('CONFIRMED');
    expect(await offerRow(p.offerId)).toMatchObject({ stockQty: 2, reservedQty: 0 });
    const confirmed = (await outbox(orderId)).filter((e) => e.eventType === 'order.confirmed');
    expect(confirmed).toHaveLength(1);
    const status = await http().get(`/orders/${orderId}/status`).set('authorization', user.auth);
    expect(status.body).toMatchObject({ status: 'CONFIRMED', paymentState: 'PAID' });
  });

  it('a failed attempt keeps the order payable; retry with another payment wins; double capture is refunded', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 3 });
    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const { orderId } = (await place(user, s)).body;
    const gw = await initiate(user, orderId);
    const fail = {
      id: `pay_${run}_f_${orderId.slice(0, 6)}`,
      orderId: gw.providerOrderId,
      amount: gw.amountPaise,
    };
    expect((await webhook('payment.failed', fail, `evt_${orderId}_f`)).body.outcome).toBe('FAILED');
    await consumer.drain();
    expect((await orderRow(orderId)).status).toBe('PENDING_PAYMENT');
    expect((await outbox(orderId)).map((e) => e.eventType)).toContain('order.payment_failed');

    const first = {
      id: `pay_${run}_a_${orderId.slice(0, 6)}`,
      orderId: gw.providerOrderId,
      amount: gw.amountPaise,
    };
    const second = {
      id: `pay_${run}_b_${orderId.slice(0, 6)}`,
      orderId: gw.providerOrderId,
      amount: gw.amountPaise,
    };
    expect((await webhook('payment.captured', first, `evt_${orderId}_a`)).body.outcome).toBe(
      'CAPTURED',
    );
    const before = bank.refunds.length;
    expect((await webhook('payment.captured', second, `evt_${orderId}_b`)).body.outcome).toBe(
      'DUPLICATE_REFUNDED',
    );
    expect(bank.refunds.slice(before)).toEqual([
      { paymentId: second.id, amount: BigInt(gw.amountPaise) },
    ]);
    await consumer.drain();
    expect((await orderRow(orderId)).status).toBe('CONFIRMED');
    expect((await offerRow(p.offerId)).stockQty).toBe(2);
  });

  it('late capture with stock re-reserves and confirms (M4.34)', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 2 });
    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const { orderId } = (await place(user, s)).body;
    const gw = await initiate(user, orderId);
    await prisma.order.update({
      where: { id: orderId },
      data: { payBy: new Date(Date.now() - 1000) },
    });
    await worker.sweep();
    expect((await orderRow(orderId)).status).toBe('PAYMENT_FAILED');
    const pay = {
      id: `pay_${run}_late_${orderId.slice(0, 6)}`,
      orderId: gw.providerOrderId,
      amount: gw.amountPaise,
    };
    expect((await webhook('payment.captured', pay, `evt_${orderId}_late`)).body.outcome).toBe(
      'CAPTURED',
    );
    await consumer.drain();
    expect((await orderRow(orderId)).status).toBe('CONFIRMED');
    expect(await offerRow(p.offerId)).toMatchObject({ stockQty: 1, reservedQty: 0 });
    const types = (
      await prisma.orderEventRow.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })
    ).map((e) => e.type);
    expect(types).toEqual(['PLACED', 'PAYMENT_EXPIRED', 'CONFIRMED_LATE_CAPTURE']);
  });

  it('late capture without stock: CANCELLED_NO_STOCK and automatic refund (M4.34)', async () => {
    const userA = await newUser();
    const userB = await newUser();
    const p = await newOffer({ stock: 1 });
    const s = await buyNow(userA, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const { orderId } = (await place(userA, s)).body;
    const gw = await initiate(userA, orderId);
    await prisma.order.update({
      where: { id: orderId },
      data: { payBy: new Date(Date.now() - 1000) },
    });
    await worker.sweep();
    // Someone else buys the released last unit.
    expect((await place(userB, await buyNow(userB, p.skuId, { type: 'COD' }))).body.status).toBe(
      'CONFIRMED',
    );
    const before = bank.refunds.length;
    const pay = {
      id: `pay_${run}_ns_${orderId.slice(0, 6)}`,
      orderId: gw.providerOrderId,
      amount: gw.amountPaise,
    };
    await webhook('payment.captured', pay, `evt_${orderId}_ns`);
    await consumer.drain();
    const o = await orderRow(orderId);
    expect([o.status, o.cancelReason]).toEqual(['CANCELLED_NO_STOCK', 'NO_STOCK']);
    expect(bank.refunds.slice(before)).toEqual([
      { paymentId: pay.id, amount: BigInt(gw.amountPaise) },
    ]);
    expect(await offerRow(p.offerId)).toMatchObject({ stockQty: 0, reservedQty: 0 });
    const cancelled = (await outbox(orderId)).find((e) => e.eventType === 'order.cancelled');
    expect(cancelled?.payload).toMatchObject({
      status: 'CANCELLED_NO_STOCK',
      reason: 'NO_STOCK',
      cancelledBy: 'system',
    });
    // The refund sweep sees nothing left to refund.
    await worker.sweep();
    expect(bank.refunds.length).toBe(before + 1);
    const detail = await http().get(`/orders/${orderId}`).set('authorization', userA.auth);
    expect(detail.body.payment.state).toBe('REFUNDED');
  });

  it('cancel: COD restocks; paid online order is refunded; shipped orders cannot be cancelled', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 4 });
    const cod = (await place(user, await buyNow(user, p.skuId, { type: 'COD' }))).body;
    expect((await offerRow(p.offerId)).stockQty).toBe(3);
    const c1 = await http()
      .post(`/orders/${cod.orderId}/cancel`)
      .set('authorization', user.auth)
      .send({ reason: 'Changed my mind' });
    expect(c1.status).toBe(200);
    expect(c1.body).toMatchObject({
      status: 'CANCELLED',
      canCancel: false,
      cancelReason: 'Changed my mind',
    });
    expect((await offerRow(p.offerId)).stockQty).toBe(4);

    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const { orderId } = (await place(user, s)).body;
    const gw = await initiate(user, orderId);
    await webhook(
      'payment.captured',
      {
        id: `pay_${run}_c_${orderId.slice(0, 6)}`,
        orderId: gw.providerOrderId,
        amount: gw.amountPaise,
      },
      `evt_${orderId}_c`,
    );
    await consumer.drain();
    const before = bank.refunds.length;
    const c2 = await http()
      .post(`/orders/${orderId}/cancel`)
      .set('authorization', user.auth)
      .send({});
    expect(c2.body.status).toBe('CANCELLED');
    expect(bank.refunds.length).toBe(before + 1);
    expect((await offerRow(p.offerId)).stockQty).toBe(4);

    const shipped = (await place(user, await buyNow(user, p.skuId, { type: 'COD' }))).body.orderId;
    await prisma.order.update({ where: { id: shipped }, data: { status: 'SHIPPED' } });
    const c3 = await http()
      .post(`/orders/${shipped}/cancel`)
      .set('authorization', user.auth)
      .send({});
    expect([c3.status, c3.body.code]).toEqual([409, 'ORDER_NOT_CANCELLABLE']);
    // Other users' orders are invisible.
    const stranger = await newUser();
    expect(
      (await http().get(`/orders/${shipped}`).set('authorization', stranger.auth)).status,
    ).toBe(404);
  });

  it('coupon + gift-card balance reduce what the gateway collects; cancel gives both back', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 5 });
    const card = await ledger.issueGiftCard(10_000n);
    const redeemed = await http()
      .post('/store-balance/gift-cards/redeem')
      .set('authorization', user.auth)
      .send({ code: card.code });
    expect(redeemed.body.balancePaise).toBe(10_000);
    const code = `M4FLAT${run}`.toUpperCase();
    await prisma.coupon.create({
      data: {
        code,
        type: 'FLAT',
        value: 20_000n,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 86_400_000),
        totalLimit: 10,
      },
    });
    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' }, 1, {
      couponCode: code.toLowerCase(),
      useStoreBalance: true,
    });
    expect(s.totals).toMatchObject({
      totalPaise: 98_000,
      storeBalancePaise: 10_000,
      payablePaise: 88_000,
    });
    const placed = (await place(user, s)).body;
    expect(placed.next).toMatchObject({ type: 'PAY', amountPaise: 88_000 });
    expect((await initiate(user, placed.orderId)).amountPaise).toBe(88_000);
    expect(await ledger.balance(user.id)).toBe(0n);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(1);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: placed.orderId } });
    expect(Number(item.discountPaise)).toBe(20_000);
    expect(Number(item.taxablePaise + item.cgstPaise + item.sgstPaise)).toBe(98_000);

    await http().post(`/orders/${placed.orderId}/cancel`).set('authorization', user.auth).send({});
    expect(await ledger.balance(user.id)).toBe(10_000n);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { code } })).usedCount).toBe(0);
    // The coupon is usable again; a second redemption of the card is not.
    const again = await http()
      .post('/store-balance/gift-cards/redeem')
      .set('authorization', user.auth)
      .send({ code: card.code });
    expect(again.body.code).toBe('GIFT_CARD_INVALID');
  });

  it('never oversells: 40 concurrent buyers, 7 units → exactly 7 orders', async () => {
    const p = await newOffer({ stock: 7, price: 50_000 });
    const users = await Promise.all(Array.from({ length: 40 }, () => newUser()));
    const sessionsFor = await Promise.all(users.map((u) => buyNow(u, p.skuId, { type: 'COD' })));
    const results = await Promise.all(users.map((u, i) => place(u, sessionsFor[i])));
    const ok = results.filter((r) => r.status === 201);
    expect(ok).toHaveLength(7);
    expect(
      results.filter((r) => r.status !== 201).every((r) => r.body.code === 'OUT_OF_STOCK'),
    ).toBe(true);
    expect(await offerRow(p.offerId)).toMatchObject({ stockQty: 0, reservedQty: 0 });
    expect(await prisma.orderItem.count({ where: { skuId: p.skuId } })).toBe(7);
  });

  it('lists orders newest first with status filter and cursor', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 5 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push((await place(user, await buyNow(user, p.skuId, { type: 'COD' }))).body.orderId);
    const page1 = await http().get('/orders?limit=2').set('authorization', user.auth);
    expect(page1.body.items.map((o: { id: string }) => o.id)).toEqual([ids[2], ids[1]]);
    const page2 = await http()
      .get(`/orders?limit=2&cursor=${page1.body.nextCursor}`)
      .set('authorization', user.auth);
    expect(page2.body).toMatchObject({ items: [{ id: ids[0] }], nextCursor: null });
    const none = await http().get('/orders?status=CANCELLED').set('authorization', user.auth);
    expect(none.body.items).toEqual([]);
  });

  // ───────── Gap fixes (M4/M6 follow-ups) ─────────

  const cartWith = async (user: { auth: string }, skus: string[]) => {
    for (const sku of skus) {
      const r = await http()
        .post('/cart/items')
        .set('authorization', user.auth)
        .set('content-type', 'application/json')
        .send({ sku, qty: 1 });
      expect(r.status).toBe(201);
    }
  };

  it('order.confirmed carries invoice data; invoice link is signed and owner-only', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 3, seller: sellerMH });
    const { orderId } = (await place(user, await buyNow(user, p.skuId, { type: 'COD' }))).body;
    const confirmed = (await outbox(orderId)).find((e) => e.eventType === 'order.confirmed')!;
    const payload = confirmed.payload as {
      billingAddress: { pincode: string };
      shipments: {
        shipmentId: string;
        sellerGstin: string;
        sellerAddress: string;
        deliveryFeePaise: number;
        invoiceNumber: string;
        invoiceKey: string;
        items: { hsnCode: string }[];
      }[];
    };
    expect(payload.billingAddress.pincode).toBe('560034');
    const sh = payload.shipments[0];
    expect(sh.sellerGstin).toMatch(/^27[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
    expect(sh.sellerAddress).toContain('Maharashtra - 400001');
    expect(typeof sh.deliveryFeePaise).toBe('number');
    expect(sh.items[0].hsnCode).toMatch(/^\d{4}$/);
    expect(sh.invoiceKey).toBe(`${orderId}/${sh.shipmentId}.pdf`);

    const d = await http().get(`/orders/${orderId}`).set('authorization', user.auth);
    expect(d.body.shipments[0].invoiceAvailable).toBe(true);

    const store = app.get(InvoiceStore);
    const spy = jest
      .spyOn(store, 'signedUrl')
      .mockResolvedValueOnce('http://s3.test/invoices/x.pdf?X-Amz-Signature=abc')
      .mockResolvedValueOnce(null);
    const url = `/orders/${orderId}/shipments/${sh.shipmentId}/invoice`;
    const ok = await http().get(url).set('authorization', user.auth);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      number: sh.invoiceNumber,
      url: expect.stringContaining('X-Amz-Signature'),
    });
    expect(spy).toHaveBeenCalledWith(sh.invoiceKey, sh.invoiceNumber, 300);
    const notYet = await http().get(url).set('authorization', user.auth);
    expect(notYet.body.code).toBe('INVOICE_NOT_READY');
    const stranger = await newUser();
    const other = await http().get(url).set('authorization', stranger.auth);
    expect(other.body.code).toBe('ORDER_NOT_FOUND');
    spy.mockRestore();
  });

  it('order list has slug, delivery date and years; status has number + failure reason', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 3 });
    await place(user, await buyNow(user, p.skuId, { type: 'COD' }));
    const list = await http().get('/orders').set('authorization', user.auth);
    expect(list.body.years).toEqual([new Date().getUTCFullYear()]);
    expect(list.body.items[0].previews[0]).toMatchObject({
      slug: expect.stringMatching(/^m4-/),
      expectedDeliveryDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      deliveredAt: null,
    });

    const s = await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' });
    const placed = (await place(user, s)).body;
    const gw = await initiate(user, placed.orderId);
    const fail = { id: `pay_${run}_gf`, orderId: gw.providerOrderId, amount: gw.amountPaise };
    await webhook('payment.failed', fail, `evt_${placed.orderId}_gf`);
    await consumer.drain();
    const st = await http().get(`/orders/${placed.orderId}/status`).set('authorization', user.auth);
    expect(st.body).toMatchObject({
      orderNumber: placed.orderNumber,
      failureReason: 'Declined by bank',
    });
  });

  it('PATCH /checkout removeLines drops lines from the session, not the cart', async () => {
    const user = await newUser();
    const a = await newOffer({ stock: 3 });
    const b = await newOffer({ stock: 3, seller: sellerMH });
    await cartWith(user, [a.skuId, b.skuId]);
    const created = await http()
      .post('/checkout')
      .set('authorization', user.auth)
      .send({ source: 'CART' });
    const patched = await http()
      .patch(`/checkout/${created.body.id}`)
      .set('authorization', user.auth)
      .send({ removeLines: [{ skuId: b.skuId, sellerId: sellerMH }] });
    expect(patched.status).toBe(200);
    const skus = patched.body.shipments.flatMap((x: { lines: { skuId: string }[] }) =>
      x.lines.map((l) => l.skuId),
    );
    expect(skus).toEqual([a.skuId]);
    const cart = await prisma.cart.findFirstOrThrow({
      where: { userId: user.id },
      include: { items: true },
    });
    expect(cart.items).toHaveLength(2);
    const all = await http()
      .patch(`/checkout/${created.body.id}`)
      .set('authorization', user.auth)
      .send({ removeLines: [{ skuId: a.skuId, sellerId: sellerKA }] });
    expect(all.status).toBe(422);
    expect(all.body.code).toBe('CHECKOUT_INVALID');
  });

  it('lightning deal claims are released on cancel and payment expiry, not twice', async () => {
    const user = await newUser();
    const p = await newOffer({ stock: 10, price: 118_000 });
    const deal = await prisma.lightningDeal.create({
      data: {
        offerId: p.offerId,
        skuId: p.skuId,
        productId: p.productId,
        title: 'Deal',
        dealPricePaise: 99_000n,
        quantityCap: 2,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    const claimed = async () =>
      (await prisma.lightningDeal.findUniqueOrThrow({ where: { id: deal.id } })).claimedQty;

    const cod = (await place(user, await buyNow(user, p.skuId, { type: 'COD' }))).body;
    expect(cod.totalPaise).toBeLessThan(118_000);
    expect(await claimed()).toBe(1);
    await http()
      .post(`/orders/${cod.orderId}/cancel`)
      .set('authorization', user.auth)
      .send({})
      .expect(200);
    expect(await claimed()).toBe(0);
    const claim = await prisma.dealClaim.findFirstOrThrow({ where: { orderId: cod.orderId } });
    expect(claim.releasedAt).not.toBeNull();

    const online = (
      await place(user, await buyNow(user, p.skuId, { type: 'ONLINE', provider: 'bank' }))
    ).body;
    expect(await claimed()).toBe(1);
    await prisma.order.update({
      where: { id: online.orderId },
      data: { payBy: new Date(Date.now() - 1000) },
    });
    await worker.sweep();
    expect((await orderRow(online.orderId)).status).toBe('PAYMENT_FAILED');
    expect(await claimed()).toBe(0);
    await worker.sweep();
    expect(await claimed()).toBe(0);
    await prisma.lightningDeal.update({ where: { id: deal.id }, data: { active: false } });
  });

  it('bank offer is apportioned before per-line GST: lines, tax and order reconcile', async () => {
    const offer = await prisma.bankOffer.create({
      data: {
        title: '10% off ShopSphere Bank',
        provider: 'bank',
        percentBp: 1000,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    try {
      const user = await newUser();
      const a = await newOffer({ stock: 3, price: 149_900 });
      const b = await newOffer({ stock: 3, price: 33_300, seller: sellerMH });
      await cartWith(user, [a.skuId, b.skuId]);
      const created = await http()
        .post('/checkout')
        .set('authorization', user.auth)
        .send({ source: 'CART' });
      const s = (
        await http()
          .patch(`/checkout/${created.body.id}`)
          .set('authorization', user.auth)
          .send({ paymentMethod: { type: 'ONLINE', provider: 'bank' } })
      ).body;
      const bankOff = s.totals.bankOfferDiscountPaise as number;
      expect(bankOff).toBe(Math.floor((149_900 + 33_300) / 10));
      type L = {
        lineTotalPaise: number;
        discountPaise: number;
        tax: { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number };
      };
      const lines: L[] = s.shipments.flatMap((x: { lines: L[] }) => x.lines);
      const gst = (l: L) => l.tax.cgstPaise + l.tax.sgstPaise + l.tax.igstPaise;
      expect(lines.reduce((t, l) => t + l.discountPaise, 0)).toBe(bankOff);
      for (const l of lines) {
        expect(l.tax.taxablePaise + gst(l)).toBe(l.lineTotalPaise - l.discountPaise);
      }
      expect(lines.reduce((t, l) => t + gst(l), 0)).toBe(s.totals.tax.totalPaise);
      const goods = lines.reduce((t, l) => t + l.tax.taxablePaise + gst(l), 0);
      expect(goods + s.totals.deliveryPaise).toBe(s.totals.totalPaise);

      const { orderId } = (await place(user, s)).body;
      const o = await prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });
      const stored = o.items.reduce(
        (t, i) => t + Number(i.taxablePaise + i.cgstPaise + i.sgstPaise + i.igstPaise),
        0,
      );
      expect(stored + Number(o.deliveryPaise)).toBe(Number(o.totalPaise));
      expect(Number(o.cgstPaise + o.sgstPaise + o.igstPaise)).toBe(s.totals.tax.totalPaise);
    } finally {
      await prisma.bankOffer.update({ where: { id: offer.id }, data: { active: false } });
    }
  });
});
