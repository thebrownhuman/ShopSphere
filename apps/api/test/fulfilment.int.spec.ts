/**
 * M5 fulfilment end to end against a real Postgres, with the real courier-sim and bank-sim apps
 * running in-process on ephemeral ports: paid order → seller accepts, packs, books label →
 * courier-sim tracking webhooks → order DELIVERED (outbox events) → settlement line → T+7
 * payout recorded in bank-sim.
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
import { settle } from '../src/modules/settlement/settlement-math';
import { SettlementService } from '../src/modules/settlement/settlement.service';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { CourierRegistry } from '../src/modules/shipping/courier.registry';
import { CourierSimProvider } from '../src/modules/shipping/providers/courier-sim.provider';
import { FakeRedis } from './fake-redis';

process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m5_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';

const COURIER_SECRET = 'cs_test_webhook_secret';
const INTERNAL = 'dev-internal-token-change-me';
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

describe('fulfilment, courier tracking and settlement (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let consumer: PaymentEventsConsumer;
  let settlement: SettlementService;
  let baseUrl: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bank: { nest: any; url: string; svc: any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let courier: { nest: any; url: string; svc: any };
  let sellerId: string;
  let sellerAuth: string;
  let skuId: string;
  const http = () => request(baseUrl);

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
    settlement = app.get(SettlementService);

    process.env.WEBHOOK_URL = `${baseUrl}/shipping/webhooks/courier-sim`;
    courier = await startSim('courier-sim');
    courier.svc.autoAdvance = false;
    app.get(CourierRegistry).register(
      new CourierSimProvider({
        apiUrl: `${courier.url}/v1`,
        apiKey: 'cs_test_api_key',
        webhookSecret: COURIER_SECRET,
      }),
    );

    const cat = await prisma.category.create({
      data: { slug: `m5-${run}`, name: 'M5 test', path: `m5-${run}`, gstRateBp: 1800 },
    });
    app.get(CategoryTreeService).invalidate();
    const brand = await prisma.brand.create({ data: { slug: `m5-brand-${run}`, name: 'M5' } });
    const seller = await prisma.seller.create({
      data: {
        name: 'M5 Seller',
        slug: `m5-seller-${run}`,
        pincode: '560001',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
    });
    sellerId = seller.id;
    const sellerUser = await login('Seller Owner');
    await prisma.sellerAccount.create({
      data: { userId: sellerUser.id, sellerId, displayName: 'M5 Seller', status: 'APPROVED' },
    });
    sellerAuth = sellerUser.auth;
    const product = await prisma.product.create({
      data: {
        slug: `m5-${run}`,
        title: 'M5 Product',
        brandId: brand.id,
        categoryId: cat.id,
        skus: { create: { code: `M5-${run}`, isDefault: true } },
      },
      include: { skus: true },
    });
    skuId = product.skus[0].id;
    await prisma.offer.create({
      data: {
        skuId,
        sellerId,
        price: 118_000n,
        mrp: 150_000n,
        stockQty: 20,
        maxPerOrder: 5,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await courier.nest.close();
    await bank.nest.close();
  });

  async function paidOrder() {
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
      .send({ source: 'BUY_NOW', skuId, qty: 1 });
    expect(created.status).toBe(201);
    const patched = await http()
      .patch(`/checkout/${created.body.id}`)
      .set('authorization', buyer.auth)
      .send({ paymentMethod: { type: 'ONLINE', provider: 'bank' } });
    expect(patched.status).toBe(200);
    const placed = await http()
      .post(`/checkout/${created.body.id}/place-order`)
      .set('authorization', buyer.auth)
      .set('idempotency-key', `m5-${Math.random()}`)
      .send({ expectedTotalPaise: patched.body.totals.totalPaise });
    expect(placed.status).toBe(201);
    const orderId = placed.body.orderId as string;
    const paid = await http()
      .post(`/orders/${orderId}/test-payment`)
      .set('authorization', buyer.auth)
      .send({ outcome: 'success' });
    expect(paid.status).toBe(200);
    await consumer.drain();
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.status).toBe('CONFIRMED');
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId } });
    return { buyer, orderId, shipmentId: shipment.id };
  }

  const orderStatus = async (id: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id } })).status;

  it('paid order → seller accepts, packs, labels → courier delivers → settles → paid out', async () => {
    const { orderId, shipmentId } = await paidOrder();

    const queue = await http()
      .get('/seller/orders?status=CONFIRMED')
      .set('authorization', sellerAuth);
    expect(queue.status).toBe(200);
    const row = queue.body.items.find((s: { id: string }) => s.id === shipmentId);
    expect(row).toMatchObject({
      status: 'CONFIRMED',
      orderStatus: 'CONFIRMED',
      shipTo: { city: 'Mumbai', pincode: '400001' },
      itemsPaise: 118_000,
    });
    expect(row.shipTo.phone).toBeUndefined();

    // Label before packing is refused.
    expect(
      (await http().post(`/seller/orders/${shipmentId}/label`).set('authorization', sellerAuth))
        .body.code,
    ).toBe('SHIPMENT_STATE_INVALID');

    const accepted = await http()
      .post(`/seller/orders/${shipmentId}/accept`)
      .set('authorization', sellerAuth);
    expect(accepted.body.status).toBe('ACCEPTED');
    const packed = await http()
      .post(`/seller/orders/${shipmentId}/pack`)
      .set('authorization', sellerAuth)
      .send({ weightGrams: 800 });
    expect(packed.body.status).toBe('PACKED');
    expect(await orderStatus(orderId)).toBe('PACKED');

    const labelled = await http()
      .post(`/seller/orders/${shipmentId}/label`)
      .set('authorization', sellerAuth);
    expect(labelled.status).toBe(200);
    // 560001 → 400001 is METRO: ₹50 first 500 g + ₹25 next slab.
    expect(labelled.body).toMatchObject({
      status: 'LABEL_CREATED',
      courier: 'courier-sim',
      shippingCostPaise: 7_500,
    });
    const awb = labelled.body.awb as string;
    // Idempotent: a second click returns the same AWB.
    const again = await http()
      .post(`/seller/orders/${shipmentId}/label`)
      .set('authorization', sellerAuth);
    expect(again.body.awb).toBe(awb);
    const pdf = await http()
      .get(`/seller/shipments/${shipmentId}/label.pdf`)
      .set('authorization', sellerAuth)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // Courier picks up → SHIPPED via webhook; replaying every webhook changes nothing.
    await request(courier.url)
      .post(`/v1/shipments/${awb}/advance`)
      .set('x-api-key', 'cs_test_api_key')
      .expect(200);
    expect(
      await until(
        () => orderStatus(orderId),
        (s) => s === 'SHIPPED',
      ),
    ).toBe('SHIPPED');
    await request(courier.url)
      .post(`/v1/shipments/${awb}/replay`)
      .set('x-api-key', 'cs_test_api_key')
      .expect(200);

    for (const want of ['OUT_FOR_DELIVERY', 'DELIVERED']) {
      await request(courier.url)
        .post(`/v1/shipments/${awb}/advance`)
        .set('x-api-key', 'cs_test_api_key')
        .expect(200);
      expect(
        await until(
          () => orderStatus(orderId),
          (s) => s === want,
        ),
      ).toBe(want);
    }
    await request(courier.url)
      .post(`/v1/shipments/${awb}/replay`)
      .set('x-api-key', 'cs_test_api_key')
      .expect(200);
    await until(
      () => prisma.shipmentTrackingEvent.count({ where: { shipmentId } }),
      (c) => c >= 3,
    );
    // Let replayed deliveries land before counting.
    await until(
      async () =>
        (courier.svc.deliveries as { awb: string; delivered: boolean }[]).filter(
          (d) => d.awb === awb && !d.delivered,
        ).length,
      (c) => c === 0,
    );

    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: orderId, aggregateType: 'order' },
      orderBy: { createdAt: 'asc' },
    });
    const types = events.map((e) => e.eventType);
    expect(types.filter((t) => t === 'order.shipped')).toHaveLength(1);
    expect(types.filter((t) => t === 'order.out_for_delivery')).toHaveLength(1);
    expect(types.filter((t) => t === 'order.delivered')).toHaveLength(1);
    expect(events.find((e) => e.eventType === 'order.delivered')!.payload).toMatchObject({
      status: 'DELIVERED',
      fromStatus: 'OUT_FOR_DELIVERY',
      shipmentId,
      awb,
      courier: 'courier-sim',
    });
    expect(await prisma.shipmentTrackingEvent.count({ where: { shipmentId } })).toBe(3);

    // Out-of-order straggler (new event id) is recorded but ignored; tampered body is refused.
    const late = Buffer.from(
      JSON.stringify({
        eventId: `late-${run}`,
        awb,
        reference: shipmentId,
        status: 'OUT_FOR_DELIVERY',
        sequence: 2,
        location: 'Hub',
        occurredAt: new Date().toISOString(),
      }),
    );
    const lateRes = await http()
      .post('/shipping/webhooks/courier-sim')
      .set('content-type', 'application/json')
      .set('x-courier-signature', hmacSha256Hex(COURIER_SECRET, late))
      .send(late.toString());
    expect(lateRes.status).toBe(200);
    expect(lateRes.body).toMatchObject({
      duplicate: false,
      applied: false,
      orderStatus: 'DELIVERED',
    });
    await http()
      .post('/shipping/webhooks/courier-sim')
      .set('content-type', 'application/json')
      .set('x-courier-signature', hmacSha256Hex('wrong', late))
      .send(late.toString())
      .expect(401);
    expect(await orderStatus(orderId)).toBe('DELIVERED');

    const detail = await http()
      .get(`/seller/shipments/${shipmentId}`)
      .set('authorization', sellerAuth);
    expect(detail.body.status).toBe('DELIVERED');
    expect(
      detail.body.tracking.map((t: { status: string; applied: boolean }) => [t.status, t.applied]),
    ).toEqual([
      ['SHIPPED', true],
      ['OUT_FOR_DELIVERY', true],
      ['DELIVERED', true],
      ['OUT_FOR_DELIVERY', false],
    ]);

    // Settlement line written with the delivery.
    const line = await prisma.settlementLine.findUniqueOrThrow({ where: { shipmentId } });
    const items = await prisma.orderItem.findMany({ where: { shipmentId } });
    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    const expected = settle({
      items: items.map((i) => ({
        taxablePaise: Number(i.taxablePaise),
        cgstPaise: Number(i.cgstPaise),
        sgstPaise: Number(i.sgstPaise),
        igstPaise: Number(i.igstPaise),
      })),
      courierCostPaise: 7_500,
      buyerDeliveryFeePaise: Number(shipment.deliveryFeePaise),
    });
    expect(expected.grossPaise).toBe(118_000);
    expect(expected.tcsPaise).toBe(1_000);
    expect(Number(line.netPaise)).toBe(expected.netPaise);
    expect(line.status).toBe('PENDING');
    expect(line.eligibleAt.getTime() - line.deliveredAt.getTime()).toBe(7 * 86_400_000);

    // Not due yet: nothing paid for this seller.
    await settlement.runPayouts(new Date(line.deliveredAt.getTime() + 6 * 86_400_000));
    expect(await prisma.sellerPayout.count({ where: { sellerId } })).toBe(0);

    const summary = await settlement.runPayouts(new Date(line.eligibleAt.getTime() + 1_000));
    expect(summary.paid).toBeGreaterThanOrEqual(1);
    const payout = await prisma.sellerPayout.findFirstOrThrow({ where: { sellerId } });
    expect(payout).toMatchObject({ status: 'PAID', lineCount: 1 });
    expect(Number(payout.amountPaise)).toBe(expected.netPaise);
    expect(payout.utr).toMatch(/^SSBN/);
    const inBank = bank.svc.getPayout(payout.bankPayoutId);
    expect(inBank).toMatchObject({
      status: 'processed',
      amount: expected.netPaise,
      utr: payout.utr,
    });
    expect((await prisma.settlementLine.findUniqueOrThrow({ where: { shipmentId } })).status).toBe(
      'PAID',
    );
    // Re-running pays nothing twice.
    await settlement.runPayouts(new Date(line.eligibleAt.getTime() + 2_000));
    expect(await prisma.sellerPayout.count({ where: { sellerId } })).toBe(1);

    const payouts = await http().get('/seller/payouts').set('authorization', sellerAuth);
    expect(payouts.body.items[0]).toMatchObject({
      id: payout.id,
      status: 'PAID',
      amountPaise: expected.netPaise,
    });
    const one = await http().get(`/seller/payouts/${payout.id}`).set('authorization', sellerAuth);
    expect(one.body.lines[0]).toMatchObject({ shipmentId, tcsPaise: 1_000, status: 'PAID' });
    const day = new Date(line.deliveredAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const stmt = await http()
      .get(`/seller/statements?from=${day}&to=${day}`)
      .set('authorization', sellerAuth);
    expect(stmt.body.totals.netPaise).toBe(expected.netPaise);
    expect(stmt.body.paidOutPaise).toBe(expected.netPaise);
  });

  it('seller routes need a seller account and only show own shipments', async () => {
    const { shipmentId } = await paidOrder();
    const buyer = await login('Not a seller');
    await http().get('/seller/orders').set('authorization', buyer.auth).expect(404);
    await prisma.sellerAccount.create({ data: { userId: buyer.id, displayName: 'Pending' } });
    const pending = await http().get('/seller/payouts').set('authorization', buyer.auth);
    expect(pending.status).toBe(403);
    expect(pending.body.code).toBe('SELLER_NOT_APPROVED');
    await http().get('/seller/orders').expect(401);
    const otherSeller = await prisma.seller.create({
      data: {
        name: 'Other',
        slug: `m5-other-${run}`,
        pincode: '110001',
        city: 'Delhi',
        state: 'Delhi',
      },
    });
    const other = await login('Other owner');
    await prisma.sellerAccount.create({
      data: {
        userId: other.id,
        sellerId: otherSeller.id,
        displayName: 'Other',
        status: 'APPROVED',
      },
    });
    await http()
      .post(`/seller/orders/${shipmentId}/accept`)
      .set('authorization', other.auth)
      .expect(404);
  });

  it('customer cancel stops the seller from packing', async () => {
    const { buyer, orderId, shipmentId } = await paidOrder();
    await http()
      .post(`/seller/orders/${shipmentId}/accept`)
      .set('authorization', sellerAuth)
      .expect(200);
    await http()
      .post(`/orders/${orderId}/cancel`)
      .set('authorization', buyer.auth)
      .send({})
      .expect(200);
    const res = await http()
      .post(`/seller/orders/${shipmentId}/pack`)
      .set('authorization', sellerAuth)
      .send({});
    expect(res.status).toBe(409);
  });

  it('delivery estimates switch to the courier serviceability matrix after refresh', async () => {
    await http().post('/shipping/internal/refresh-serviceability').expect(401);
    const r = await http()
      .post('/shipping/internal/refresh-serviceability')
      .set('x-internal-token', INTERNAL);
    expect(r.status).toBe(200);
    expect(r.body.provider).toBe('courier-sim');
    // Field post office pincodes (9xxxxx) are outside the courier network.
    const fpo = await http().get(`/delivery-estimate?sku=${skuId}&pincode=904001`);
    expect(fpo.body.serviceable).toBe(false);
    const metro = await http().get(`/delivery-estimate?sku=${skuId}&pincode=400001`);
    expect(metro.body).toMatchObject({ serviceable: true, zone: 'METRO', slaDays: 2 });
  });
});
