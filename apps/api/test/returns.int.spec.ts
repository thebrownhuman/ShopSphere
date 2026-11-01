/**
 * M6.1 returns end to end against a real Postgres, with the real courier-sim and bank-sim apps
 * in-process: delivered order → return request (eligibility) → reverse pickup booked with
 * courier-sim → pickup webhooks (duplicates/replays ignored) → seller QC on receipt → refund to
 * the original method (bank-sim) or instantly to ShopSphere Pay balance (ledger).
 * Run with `pnpm --filter @shopsphere/api test:int` (DATABASE_URL migrated with `prisma migrate deploy`).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CategoryTreeService } from '../src/modules/catalog/category-tree.service';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { PaymentEventsConsumer } from '../src/modules/order/payment-events.consumer';
import { hmacSha256Hex } from '../src/modules/payment/providers/signature';
import { LedgerService } from '../src/modules/ledger/ledger.service';
import { pickupDates } from '../src/modules/returns/return-policy';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { CourierRegistry } from '../src/modules/shipping/courier.registry';
import { CourierSimProvider } from '../src/modules/shipping/providers/courier-sim.provider';
import { FakeRedis } from './fake-redis';

process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m6_returns?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';

const COURIER_SECRET = 'cs_test_webhook_secret';
const run = Date.now().toString(36);

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
/** Boots a sibling simulator app with its own Nest instance (it has its own node_modules). */
async function startSim(
  app: 'bank-sim' | 'courier-sim',
): Promise<{ nest: any; url: string; svc: any }> {
  const dir = join(__dirname, '..', '..', app);
  const { NestFactory } = require(join(dir, 'node_modules', '@nestjs', 'core'));
  const { AppModule: SimModule } = require(join(dir, 'src', 'app.module'));
  const nest = await NestFactory.create(SimModule, { logger: false });
  await nest.listen(0, '127.0.0.1');
  const svcFile = app === 'bank-sim' ? 'bank.service' : 'courier.service';
  const svcClass = app === 'bank-sim' ? 'BankService' : 'CourierService';
  const svc = nest.get(require(join(dir, 'src', svcFile))[svcClass]);
  return { nest, url: (await nest.getUrl()).replace('[::1]', '127.0.0.1'), svc };
}
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const KEY = 'cs_test_api_key';

describe('returns: pickup, QC on receipt and refunds (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let consumer: PaymentEventsConsumer;
  let ledger: LedgerService;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bank: { nest: any; url: string; svc: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let courier: { nest: any; url: string; svc: any };
  let sellerAuth: string;
  let skuId: string;
  let phoneSkuId: string;
  let phoneOfferId: string;
  const http = () => request(baseUrl);
  const advance = (awb: string) =>
    request(courier.url).post(`/v1/shipments/${awb}/advance`).set('x-api-key', KEY).expect(200);
  const replay = (awb: string) =>
    request(courier.url).post(`/v1/shipments/${awb}/replay`).set('x-api-key', KEY).expect(200);
  const orderStatus = async (id: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  async function login(name: string) {
    const user = await prisma.user.create({ data: { name } });
    const tokens = await sessions.create(user.id, false, {});
    return { id: user.id, auth: `Bearer ${tokens.accessToken}` };
  }

  beforeAll(async () => {
    bank = await startSim('bank-sim');
    bank.svc.sendWebhooks = false;
    process.env.BANK_API_URL = `${bank.url}/v1`;
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
    ledger = app.get(LedgerService);

    process.env.WEBHOOK_URL = `${baseUrl}/shipping/webhooks/courier-sim`;
    courier = await startSim('courier-sim');
    courier.svc.autoAdvance = false;
    app.get(CourierRegistry).register(
      new CourierSimProvider({
        apiUrl: `${courier.url}/v1`,
        apiKey: KEY,
        webhookSecret: COURIER_SECRET,
      }),
    );

    const cat = await prisma.category.create({
      data: { slug: `m6-${run}`, name: 'M6 test', path: `m6-${run}`, gstRateBp: 1800 },
    });
    app.get(CategoryTreeService).invalidate();
    const brand = await prisma.brand.create({ data: { slug: `m6-brand-${run}`, name: 'M6' } });
    const seller = await prisma.seller.create({
      data: {
        name: 'M6 Seller',
        slug: `m6-seller-${run}`,
        pincode: '560001',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
    });
    const sellerUser = await login('Seller Owner');
    await prisma.sellerAccount.create({
      data: { userId: sellerUser.id, sellerId: seller.id, displayName: 'M6', status: 'APPROVED' },
    });
    sellerAuth = sellerUser.auth;
    const product = await prisma.product.create({
      data: {
        slug: `m6-${run}`,
        title: 'M6 Kettle',
        brandId: brand.id,
        categoryId: cat.id,
        skus: { create: { code: `M6-${run}`, isDefault: true } },
      },
      include: { skus: true },
    });
    skuId = product.skus[0].id;
    await prisma.offer.create({
      data: {
        skuId,
        sellerId: seller.id,
        price: 118_000n,
        mrp: 150_000n,
        stockQty: 50,
        maxPerOrder: 5,
      },
    });
    // Replace is offered for electronics (top-level slug), not for the kettle's test category.
    const electronics = await prisma.category.upsert({
      where: { slug: 'electronics' },
      update: {},
      create: { slug: 'electronics', name: 'Electronics', path: 'electronics', gstRateBp: 1800 },
    });
    app.get(CategoryTreeService).invalidate();
    const phone = await prisma.product.create({
      data: {
        slug: `m6-phone-${run}`,
        title: 'M6 Phone',
        brandId: brand.id,
        categoryId: electronics.id,
        skus: { create: { code: `M6P-${run}`, isDefault: true } },
      },
      include: { skus: true },
    });
    phoneSkuId = phone.skus[0].id;
    phoneOfferId = (
      await prisma.offer.create({
        data: {
          skuId: phoneSkuId,
          sellerId: seller.id,
          price: 1_000_000n,
          mrp: 1_200_000n,
          stockQty: 3,
          maxPerOrder: 5,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await courier.nest.close();
    await bank.nest.close();
  });

  /** Paid online order taken through seller label + courier delivery. */
  async function deliveredOrder(sku = skuId) {
    const buyer = await login('Buyer');
    await prisma.address.create({
      data: {
        userId: buyer.id,
        name: 'Ravi',
        phone: '+919876543210',
        line1: '1 Marine Drive',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        isDefault: true,
      },
    });
    const created = await http()
      .post('/checkout')
      .set('authorization', buyer.auth)
      .send({ source: 'BUY_NOW', skuId: sku, qty: 1 });
    const patched = await http()
      .patch(`/checkout/${created.body.id}`)
      .set('authorization', buyer.auth)
      .send({ paymentMethod: { type: 'ONLINE', provider: 'bank' } });
    const placed = await http()
      .post(`/checkout/${created.body.id}/place-order`)
      .set('authorization', buyer.auth)
      .set('idempotency-key', `m6-${Math.random()}`)
      .send({ expectedTotalPaise: patched.body.totals.totalPaise });
    expect(placed.status).toBe(201);
    const orderId = placed.body.orderId as string;
    await http()
      .post(`/orders/${orderId}/test-payment`)
      .set('authorization', buyer.auth)
      .send({ outcome: 'success' })
      .expect(200);
    await consumer.drain();
    const { id: shipmentId } = await prisma.shipment.findFirstOrThrow({ where: { orderId } });
    for (const step of ['accept', 'pack', 'label']) {
      const r = await http()
        .post(`/seller/orders/${shipmentId}/${step}`)
        .set('authorization', sellerAuth)
        .send(step === 'pack' ? { weightGrams: 800 } : {});
      expect(r.status).toBeLessThan(300);
    }
    const { awb } = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    for (let i = 0; i < 3; i++) await advance(awb!);
    expect(
      await until(
        () => orderStatus(orderId),
        (s) => s === 'DELIVERED',
      ),
    ).toBe('DELIVERED');
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return { buyer, orderId, total: Number(o.totalPaise), awb: awb! };
  }

  async function requestReturn(
    buyer: { auth: string },
    orderId: string,
    refundTo: 'ORIGINAL' | 'STORE_BALANCE',
  ) {
    const info = await http().get(`/orders/${orderId}/return`).set('authorization', buyer.auth);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({
      eligible: true,
      windowDays: 10,
      refundTargets: ['ORIGINAL', 'STORE_BALANCE'],
    });
    expect(info.body.pickupDates).toEqual(pickupDates());
    const res = await http()
      .post(`/orders/${orderId}/return`)
      .set('authorization', buyer.auth)
      .send({ reason: 'DEFECTIVE', refundTo, pickupDate: info.body.pickupDates[0] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PICKUP_SCHEDULED', refundTo });
    expect(res.body.awb).toBeTruthy();
    return res.body as { id: string; awb: string; amountPaise: number };
  }

  async function pickUpAndReceive(orderId: string, ret: { id: string; awb: string }) {
    await advance(ret.awb);
    expect(
      await until(
        () => orderStatus(orderId),
        (s) => s === 'PICKED_UP',
      ),
    ).toBe('PICKED_UP');
    await advance(ret.awb);
    await advance(ret.awb);
    const received = await until(
      () => prisma.returnRequest.findUniqueOrThrow({ where: { id: ret.id } }),
      (r) => r.status === 'RECEIVED',
    );
    expect(received.status).toBe('RECEIVED');
  }

  it('refunds to the original payment method on QC pass, ignoring duplicate webhooks', async () => {
    const { buyer, orderId, total } = await deliveredOrder();
    const ret = await requestReturn(buyer, orderId, 'ORIGINAL');
    expect(ret.amountPaise).toBe(total);
    expect(await orderStatus(orderId)).toBe('RETURN_REQUESTED');
    const again = await http()
      .post(`/orders/${orderId}/return`)
      .set('authorization', buyer.auth)
      .send({ reason: 'DEFECTIVE', refundTo: 'ORIGINAL', pickupDate: pickupDates()[0] });
    expect(again.body.code).toBe('RETURN_EXISTS');

    // QC before the package arrives is refused.
    const early = await http()
      .post(`/seller/returns/${ret.id}/qc`)
      .set('authorization', sellerAuth)
      .send({ result: 'PASS' });
    expect(early.body.code).toBe('RETURN_STATE_INVALID');

    await pickUpAndReceive(orderId, ret);
    // The courier replays every webhook: nothing changes.
    await replay(ret.awb);
    await until(
      async () =>
        (courier.svc.deliveries as { awb: string; delivered: boolean }[]).filter(
          (d) => d.awb === ret.awb && !d.delivered,
        ).length,
      (c) => c === 0,
    );
    expect(await prisma.returnTrackingEvent.count({ where: { returnId: ret.id } })).toBe(3);
    const seen = await prisma.returnTrackingEvent.findFirstOrThrow({
      where: { returnId: ret.id, status: 'SHIPPED' },
    });
    const body = Buffer.from(
      JSON.stringify({
        eventId: seen.providerEventId,
        awb: ret.awb,
        reference: `RET-${ret.id}`,
        status: 'SHIPPED',
        sequence: seen.sequence,
        location: null,
        occurredAt: seen.occurredAt.toISOString(),
      }),
    );
    const dup = await http()
      .post('/shipping/webhooks/courier-sim')
      .set('content-type', 'application/json')
      .set('x-courier-signature', hmacSha256Hex(COURIER_SECRET, body))
      .send(body.toString());
    expect(dup.body).toMatchObject({ duplicate: true, applied: false, returnStatus: 'RECEIVED' });
    await http()
      .post('/shipping/webhooks/courier-sim')
      .set('content-type', 'application/json')
      .set('x-courier-signature', hmacSha256Hex('wrong', body))
      .send(body.toString())
      .expect(401);

    const list = await http()
      .get('/seller/returns?status=RECEIVED')
      .set('authorization', sellerAuth);
    expect(list.body.items.find((r: { id: string }) => r.id === ret.id)).toMatchObject({
      items: [{ title: 'M6 Kettle', qty: 1 }],
      pickupFrom: { city: 'Mumbai', pincode: '400001' },
    });

    const qc = await http()
      .post(`/seller/returns/${ret.id}/qc`)
      .set('authorization', sellerAuth)
      .send({ result: 'PASS', note: 'Sealed, works' });
    expect(qc.status).toBe(200);
    expect(qc.body.status).toBe('REFUNDED');
    expect(await orderStatus(orderId)).toBe('REFUNDED');
    const refunds = await prisma.refund.findMany({ where: { orderId } });
    expect(refunds).toHaveLength(1);
    expect(Number(refunds[0].amount)).toBe(total);
    expect(await ledger.balance(buyer.id)).toBe(0n);

    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: orderId, eventType: 'order.status_changed' },
      orderBy: { createdAt: 'asc' },
    });
    const statuses = events.map((e) => (e.payload as { status: string }).status);
    expect(statuses.filter((s) => s === 'RETURN_REQUESTED')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'PICKED_UP')).toHaveLength(1);
    expect(events.at(-1)!.payload).toMatchObject({
      status: 'REFUNDED',
      refundTo: 'ORIGINAL',
      refunds: [{ destination: 'GATEWAY', amountPaise: total }],
    });
    const info = await http().get(`/orders/${orderId}/return`).set('authorization', buyer.auth);
    expect(info.body).toMatchObject({ eligible: false, current: { status: 'REFUNDED' } });
  });

  it('shipping events and order detail carry carrier + AWB', async () => {
    const { buyer, orderId, awb } = await deliveredOrder();
    const shipped = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: orderId, eventType: 'order.shipped' },
    });
    expect(shipped.payload).toMatchObject({ courier: 'courier-sim', awb });
    const d = await http().get(`/orders/${orderId}`).set('authorization', buyer.auth);
    expect(d.body.shipments[0]).toMatchObject({ courier: 'courier-sim', awb });
    expect(d.body.shipments[0].deliveredAt).toBeTruthy();
    const delivered = d.body.events.find((e: { toStatus: string }) => e.toStatus === 'DELIVERED');
    expect(delivered).toMatchObject({ courier: 'courier-sim', awb });
  });

  it('Replace: zero-value replacement order, stock reserved, no refund, ships via courier', async () => {
    const { buyer, orderId } = await deliveredOrder(phoneSkuId);
    const stockBefore = (await prisma.offer.findUniqueOrThrow({ where: { id: phoneOfferId } }))
      .stockQty;
    const info = await http().get(`/orders/${orderId}/return`).set('authorization', buyer.auth);
    expect(info.body).toMatchObject({ eligible: true, replaceable: true });
    const kettle = await deliveredOrder();
    const kInfo = await http()
      .get(`/orders/${kettle.orderId}/return`)
      .set('authorization', kettle.buyer.auth);
    expect(kInfo.body.replaceable).toBe(false);
    const refused = await http()
      .post(`/orders/${kettle.orderId}/return`)
      .set('authorization', kettle.buyer.auth)
      .send({
        reason: 'DEFECTIVE',
        refundTo: 'ORIGINAL',
        pickupDate: pickupDates()[0],
        resolution: 'REPLACE',
      });
    expect(refused.body.code).toBe('REPLACEMENT_UNAVAILABLE');

    const res = await http()
      .post(`/orders/${orderId}/return`)
      .set('authorization', buyer.auth)
      .send({
        reason: 'DEFECTIVE',
        refundTo: 'ORIGINAL',
        pickupDate: pickupDates()[0],
        resolution: 'REPLACE',
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ resolution: 'REPLACE', amountPaise: 0 });
    const replacementId = res.body.replacementOrderId as string;
    const rep = await prisma.order.findUniqueOrThrow({
      where: { id: replacementId },
      include: { items: true, shipments: true },
    });
    expect(rep).toMatchObject({
      status: 'CONFIRMED',
      replacementOfId: orderId,
      totalPaise: 0n,
      payablePaise: 0n,
    });
    expect(rep.items).toMatchObject([{ skuId: phoneSkuId, qty: 1, lineTotalPaise: 0n }]);
    expect(rep.shipments[0].invoiceKey).toBeNull();
    // Stock taken for the replacement at request time.
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: phoneOfferId } })).stockQty).toBe(
      stockBefore - 1,
    );
    const detail = await http().get(`/orders/${replacementId}`).set('authorization', buyer.auth);
    expect(detail.body.replacementOf).toEqual({
      orderId,
      number: (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).number,
    });
    expect(detail.body.canCancel).toBe(false);

    // Seller sees it and ships the replacement through courier-sim.
    const list = await http().get('/seller/returns').set('authorization', sellerAuth);
    expect(list.body.items.find((r: { id: string }) => r.id === res.body.id)).toMatchObject({
      resolution: 'REPLACE',
      replacementOrderNumber: rep.number,
    });
    const sid = rep.shipments[0].id;
    for (const step of ['accept', 'pack', 'label']) {
      const r = await http()
        .post(`/seller/orders/${sid}/${step}`)
        .set('authorization', sellerAuth)
        .send(step === 'pack' ? { weightGrams: 300 } : {});
      expect(r.status).toBeLessThan(300);
    }
    const { awb } = await prisma.shipment.findUniqueOrThrow({ where: { id: sid } });
    for (let i = 0; i < 3; i++) await advance(awb!);
    expect(
      await until(
        () => orderStatus(replacementId),
        (s) => s === 'DELIVERED',
      ),
    ).toBe('DELIVERED');
    expect(await prisma.settlementLine.count({ where: { orderId: replacementId } })).toBe(0);

    // Original item comes back and passes QC: REPLACED, back in stock, no money moves.
    await pickUpAndReceive(orderId, { id: res.body.id, awb: res.body.awb });
    const qc = await http()
      .post(`/seller/returns/${res.body.id}/qc`)
      .set('authorization', sellerAuth)
      .send({ result: 'PASS' });
    expect(qc.body.status).toBe('REPLACED');
    expect(await orderStatus(orderId)).toBe('REPLACED');
    expect(await prisma.refund.count({ where: { orderId } })).toBe(0);
    expect(await ledger.balance(buyer.id)).toBe(0n);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: phoneOfferId } })).stockQty).toBe(
      stockBefore,
    );
  });

  it('refunds instantly to ShopSphere Pay balance when the shopper picks it', async () => {
    const { buyer, orderId, total } = await deliveredOrder();
    const ret = await requestReturn(buyer, orderId, 'STORE_BALANCE');
    await pickUpAndReceive(orderId, ret);
    const qc = await http()
      .post(`/seller/returns/${ret.id}/qc`)
      .set('authorization', sellerAuth)
      .send({ result: 'PASS' });
    expect(qc.body.status).toBe('REFUNDED');
    expect(await ledger.balance(buyer.id)).toBe(BigInt(total));
    expect(await prisma.refund.count({ where: { orderId } })).toBe(0);
    // A second QC does not refund twice.
    const again = await http()
      .post(`/seller/returns/${ret.id}/qc`)
      .set('authorization', sellerAuth)
      .send({ result: 'PASS' });
    expect(again.body.code).toBe('RETURN_STATE_INVALID');
    expect(await ledger.balance(buyer.id)).toBe(BigInt(total));
  });

  it('refuses returns outside the window, for other users and on unoffered pickup days', async () => {
    const { buyer, orderId } = await deliveredOrder();
    const stranger = await login('Stranger');
    await http().get(`/orders/${orderId}/return`).set('authorization', stranger.auth).expect(404);
    const bad = await http()
      .post(`/orders/${orderId}/return`)
      .set('authorization', buyer.auth)
      .send({ reason: 'DEFECTIVE', refundTo: 'ORIGINAL', pickupDate: '2020-01-01' });
    expect(bad.status).toBe(422);
    await prisma.shipment.updateMany({
      where: { orderId },
      data: { deliveredAt: new Date(Date.now() - 11 * 86_400_000) },
    });
    const info = await http().get(`/orders/${orderId}/return`).set('authorization', buyer.auth);
    expect(info.body).toMatchObject({ eligible: false, reason: 'The return window has closed' });
    const res = await http()
      .post(`/orders/${orderId}/return`)
      .set('authorization', buyer.auth)
      .send({ reason: 'DEFECTIVE', refundTo: 'ORIGINAL', pickupDate: pickupDates()[0] });
    expect(res.body.code).toBe('RETURN_NOT_ELIGIBLE');
    expect(await orderStatus(orderId)).toBe('DELIVERED');
  });

  it('serves help articles and takes support tickets linked to own orders', async () => {
    const { buyer, orderId } = await deliveredOrder();
    const articles = await http().get('/help/articles?q=refund');
    expect(articles.body.items.length).toBeGreaterThan(0);
    await http().get('/help/articles/return-policy').expect(200);
    const t = await http().post('/support/tickets').set('authorization', buyer.auth).send({
      category: 'ORDER',
      orderId,
      subject: 'Late order',
      message: 'Where is my order please?',
    });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ status: 'OPEN', orderId });
    expect(t.body.number).toMatch(/^SR\d{12}$/);
    const stranger = await login('Stranger');
    const denied = await http().post('/support/tickets').set('authorization', stranger.auth).send({
      category: 'ORDER',
      orderId,
      subject: 'Hmm',
      message: 'Not my order at all.',
    });
    expect(denied.status).toBe(404);
    const mine = await http().get('/support/tickets').set('authorization', buyer.auth);
    expect(mine.body.items[0].orderNumber).toMatch(/^OD/);
  });
});
