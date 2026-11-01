/**
 * M7.1 / M7.2 integration tests against a real Postgres: security headers, IDOR denial on
 * customer + seller routes, admin RBAC on the fraud queue, webhook signature rejection, and
 * fraud scoring (COD forced to prepaid, captcha step-up, manual-review hold → approve / reject).
 * Run with `pnpm --filter @shopsphere/api test:int` (DATABASE_URL migrated).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CategoryTreeService } from '../src/modules/catalog/category-tree.service';
import { TURNSTILE_DUMMY_TOKEN } from '../src/modules/identity/security/captcha.service';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { OrderService } from '../src/modules/order/order.service';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m4_test?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';
// Tighter thresholds so each rule is reachable with a handful of requests.
process.env.FRAUD_FORCE_PREPAID_SCORE = '30';
process.env.FRAUD_REVIEW_SCORE = '45';
process.env.FRAUD_CAPTCHA_SCORE = '35';
process.env.PLACE_ORDER_RATE_LIMIT_PER_MINUTE = '1000';

const run = Date.now().toString(36);
const device = (n: number) => `ss_did=dev${run}${'x'.repeat(16)}${n}`;

describe('security + fraud (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  let baseUrl: string;
  let cheapSku: string;
  let dearSku: string;
  let sellerA: { auth: string; sellerId: string };
  let sellerB: { auth: string; sellerId: string };
  let n = 0;
  const http = () => request(baseUrl);

  async function login(name: string) {
    const user = await prisma.user.create({ data: { name } });
    const tokens = await sessions.create(user.id, false, {});
    return { id: user.id, auth: `Bearer ${tokens.accessToken}` };
  }

  async function buyer() {
    const u = await login('Sec Buyer');
    await prisma.address.create({
      data: {
        userId: u.id,
        name: 'Asha',
        phone: '+919876543210',
        line1: '12 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
        isDefault: true,
      },
    });
    return u;
  }

  async function staff(role: 'SUPPORT' | 'CATALOG') {
    const u = await login(`Staff ${role}`);
    await prisma.staffRole.create({ data: { userId: u.id, role } });
    return u;
  }

  async function seller(name: string) {
    n += 1;
    const s = await prisma.seller.create({
      data: {
        name,
        slug: `m7-seller-${run}-${n}`,
        pincode: '560001',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
    });
    const u = await login(`${name} Owner`);
    await prisma.sellerAccount.create({
      data: { userId: u.id, sellerId: s.id, displayName: name, status: 'APPROVED' },
    });
    return { auth: u.auth, sellerId: s.id };
  }

  async function checkout(
    u: { auth: string },
    skuId: string,
    method: { type: 'COD' } | { type: 'ONLINE'; provider: 'bank' },
  ) {
    const created = await http()
      .post('/checkout')
      .set('authorization', u.auth)
      .send({ source: 'BUY_NOW', skuId, qty: 1 });
    expect(created.status).toBe(201);
    const patched = await http()
      .patch(`/checkout/${created.body.id}`)
      .set('authorization', u.auth)
      .send({ paymentMethod: method });
    expect(patched.status).toBe(200);
    return patched.body as {
      id: string;
      totals: { totalPaise: number };
      paymentOptions: { method: { type: string }; available: boolean; reason: string | null }[];
    };
  }

  function place(
    u: { auth: string },
    s: { id: string; totals: { totalPaise: number } },
    opts: { cookie?: string; captchaToken?: string } = {},
  ) {
    const req = http()
      .post(`/checkout/${s.id}/place-order`)
      .set('authorization', u.auth)
      .set('idempotency-key', `m7-${Math.random()}`);
    if (opts.cookie) req.set('cookie', opts.cookie);
    return req.send({ expectedTotalPaise: s.totals.totalPaise, captchaToken: opts.captchaToken });
  }

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

    const cat = await prisma.category.create({
      data: { slug: `m7-${run}`, name: 'M7 test', path: `m7-${run}`, gstRateBp: 1800 },
    });
    app.get(CategoryTreeService).invalidate();
    const brand = await prisma.brand.create({ data: { slug: `m7-brand-${run}`, name: 'M7' } });
    sellerA = await seller('M7 Seller A');
    sellerB = await seller('M7 Seller B');
    const sku = async (code: string, price: bigint) => {
      const p = await prisma.product.create({
        data: {
          slug: `m7-${run}-${code}`,
          title: `M7 ${code}`,
          brandId: brand.id,
          categoryId: cat.id,
          skus: { create: { code: `M7-${run}-${code}`, isDefault: true } },
        },
        include: { skus: true },
      });
      await prisma.offer.create({
        data: {
          skuId: p.skus[0].id,
          sellerId: sellerA.sellerId,
          price,
          mrp: price + 10_000n,
          stockQty: 500,
          maxPerOrder: 5,
        },
      });
      return p.skus[0].id;
    };
    cheapSku = await sku('cheap', 50_000n); // ₹500
    dearSku = await sku('dear', 1_500_000n); // ₹15,000 (high-value first order)
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────── M7.1 headers ─────────

  it('every API response carries the security headers and no X-Powered-By', async () => {
    const res = await http().get('/health/live');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+; includeSubDomains/);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
    const unauth = await http().get('/orders');
    expect(unauth.status).toBe(401);
    expect(unauth.headers['x-frame-options']).toBe('DENY');
  });

  // ───────── M7.1 IDOR ─────────

  it("customers cannot read or act on another customer's checkout, order, invoice or return", async () => {
    const alice = await buyer();
    const mallory = await buyer();
    const s = await checkout(alice, cheapSku, { type: 'ONLINE', provider: 'bank' });

    expect((await http().get(`/checkout/${s.id}`).set('authorization', mallory.auth)).status).toBe(
      404,
    );
    expect(
      (
        await http()
          .patch(`/checkout/${s.id}`)
          .set('authorization', mallory.auth)
          .send({ couponCode: null })
      ).status,
    ).toBe(404);
    expect((await place(mallory, s)).status).toBe(404);

    const placed = await place(alice, s, { cookie: device(1) });
    expect(placed.status).toBe(201);
    const orderId = placed.body.orderId as string;
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId } });

    for (const path of [
      `/orders/${orderId}`,
      `/orders/${orderId}/status`,
      `/orders/${orderId}/shipments/${shipment.id}/invoice`,
      `/orders/${orderId}/return`,
    ]) {
      const res = await http().get(path).set('authorization', mallory.auth);
      expect([path, res.status]).toEqual([path, 404]);
    }
    const cancel = await http()
      .post(`/orders/${orderId}/cancel`)
      .set('authorization', mallory.auth)
      .send({});
    expect(cancel.status).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'PENDING_PAYMENT',
    );
    // The owner still can.
    expect((await http().get(`/orders/${orderId}`).set('authorization', alice.auth)).status).toBe(
      200,
    );
  });

  it("sellers cannot see or work another seller's shipments", async () => {
    const alice = await buyer();
    const s = await checkout(alice, cheapSku, { type: 'COD' });
    const placed = await place(alice, s, { cookie: device(2) });
    expect(placed.status).toBe(201);
    const shipment = await prisma.shipment.findFirstOrThrow({
      where: { orderId: placed.body.orderId },
    });
    expect(shipment.sellerId).toBe(sellerA.sellerId);

    const peek = await http()
      .get(`/seller/shipments/${shipment.id}`)
      .set('authorization', sellerB.auth);
    expect(peek.status).toBe(404);
    const accept = await http()
      .post(`/seller/orders/${shipment.id}/accept`)
      .set('authorization', sellerB.auth);
    expect(accept.status).toBe(404);
    // A plain customer token is not a seller at all.
    expect([403, 404]).toContain(
      (await http().get(`/seller/shipments/${shipment.id}`).set('authorization', alice.auth))
        .status,
    );
    expect(
      (await http().get(`/seller/shipments/${shipment.id}`).set('authorization', sellerA.auth))
        .status,
    ).toBe(200);
  });

  // ───────── M7.1 webhooks + RBAC ─────────

  it('payment and courier webhooks reject unsigned or wrongly signed bodies', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    for (const path of ['/payments/webhooks/bank', '/payments/webhooks/razorpay']) {
      const res = await http()
        .post(path)
        .set('content-type', 'application/json')
        .set('x-bank-signature', 'deadbeef')
        .set('x-razorpay-signature', 'deadbeef')
        .set('x-bank-event-id', `evt-${run}`)
        .send(body);
      expect([path, res.status >= 400 && res.status < 500]).toEqual([path, true]);
    }
    const courier = await http()
      .post('/shipping/webhooks/courier-sim')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ awb: 'X', status: 'DELIVERED' }));
    expect(courier.status).toBeGreaterThanOrEqual(400);
    expect(courier.status).toBeLessThan(500);
  });

  it('worker-only internal routes refuse callers without the internal token', async () => {
    for (const path of [
      '/orders/internal/sweep',
      '/payments/internal/reconcile',
      '/settlement/internal/run-payouts',
      '/search/internal/index',
      '/reviews/internal/refresh-aggregates',
    ]) {
      const res = await http().post(path).set('x-internal-token', 'wrong-token-wrong-token');
      expect([path, res.status]).toEqual([path, 401]);
    }
  });

  it('fraud queue is staff-only and role-checked', async () => {
    const customer = await buyer();
    const catalog = await staff('CATALOG');
    const support = await staff('SUPPORT');
    expect((await http().get('/admin/fraud/assessments')).status).toBe(401);
    expect(
      (await http().get('/admin/fraud/assessments').set('authorization', customer.auth)).status,
    ).toBe(403);
    expect(
      (await http().get('/admin/fraud/assessments').set('authorization', catalog.auth)).status,
    ).toBe(403);
    const ok = await http().get('/admin/fraud/thresholds').set('authorization', support.auth);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ forcePrepaidScore: 30, reviewScore: 45 });
  });

  // ───────── M7.2 fraud ─────────

  it('scores every order and records the signals', async () => {
    const u = await buyer();
    const s = await checkout(u, cheapSku, { type: 'ONLINE', provider: 'bank' });
    const placed = await place(u, s, { cookie: device(3) });
    expect(placed.status).toBe(201);
    const a = await prisma.fraudAssessment.findUniqueOrThrow({
      where: { orderId: placed.body.orderId },
    });
    expect(a).toMatchObject({ decision: 'ALLOW', reviewStatus: 'NONE', score: 0 });
    expect(a.deviceId).toBe(device(3).split('=')[1]);
  });

  it('high-risk COD is refused (force prepaid); the same order can be paid online', async () => {
    const u = await buyer();
    // Preview: new-account COD = 20 < 30, so COD is offered…
    const s = await checkout(u, cheapSku, { type: 'COD' });
    expect(s.paymentOptions.find((o) => o.method.type === 'COD')?.available).toBe(true);
    // …but place-order without a device fingerprint adds 10 → 30 → refused.
    const refused = await place(u, s);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('COD_UNAVAILABLE');
    const blocked = await prisma.fraudAssessment.findFirstOrThrow({
      where: { checkoutId: s.id, orderId: null },
    });
    expect(blocked.decision).toBe('FORCE_PREPAID');
    expect((blocked.signals as { code: string }[]).map((x) => x.code).sort()).toEqual([
      'COD_NEW_ACCOUNT',
      'DEVICE_MISSING',
    ]);
    expect(await prisma.order.count({ where: { checkoutId: s.id } })).toBe(0);

    // High-value first COD is already refused at quote time.
    const dear = await checkout(u, dearSku, { type: 'COD' });
    const codOption = dear.paymentOptions.find((o) => o.method.type === 'COD');
    expect(codOption).toMatchObject({ available: false, reason: 'COD_RISK' });

    const online = await http()
      .patch(`/checkout/${s.id}`)
      .set('authorization', u.auth)
      .send({ paymentMethod: { type: 'ONLINE', provider: 'bank' } });
    const ok = await place(u, online.body, { cookie: device(4) });
    expect(ok.status).toBe(201);
  });

  it('velocity-driven risk requires a captcha (bot protection on place-order)', async () => {
    const u = await buyer();
    for (let i = 0; i < 3; i += 1) {
      const s = await checkout(u, cheapSku, { type: 'ONLINE', provider: 'bank' });
      expect((await place(u, s, { cookie: device(5) })).status).toBe(201);
    }
    // 4th in an hour: USER_VELOCITY 25 + DEVICE_MISSING 10 = 35 ≥ captcha score.
    const s = await checkout(u, cheapSku, { type: 'ONLINE', provider: 'bank' });
    const challenged = await place(u, s);
    expect(challenged.status).toBe(428);
    expect(challenged.body.code).toBe('CAPTCHA_REQUIRED');
    expect((await place(u, s, { captchaToken: 'wrong' })).status).toBe(428);
    expect((await place(u, s, { captchaToken: TURNSTILE_DUMMY_TOKEN })).status).toBe(201);
  });

  async function heldOrder() {
    const u = await buyer();
    // High-value first order (35) + no device fingerprint (10) = 45 → MANUAL_REVIEW.
    const s = await checkout(u, dearSku, { type: 'ONLINE', provider: 'bank' });
    const placed = await place(u, s);
    expect(placed.status).toBe(201);
    const orderId = placed.body.orderId as string;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.fraudHold).toBe(true);
    // Payment lands normally while the hold stays.
    await prisma.$transaction((tx) =>
      app.get(OrderService).confirm(tx, order, { lateCapture: false, actor: 'payment' }),
    );
    const assessment = await prisma.fraudAssessment.findUniqueOrThrow({ where: { orderId } });
    expect(assessment).toMatchObject({ decision: 'MANUAL_REVIEW', reviewStatus: 'PENDING_REVIEW' });
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId } });
    return { u, orderId, assessmentId: assessment.id, shipmentId: shipment.id };
  }

  it('manual review: held order cannot be accepted until support approves (audited)', async () => {
    const support = await staff('SUPPORT');
    const h = await heldOrder();

    const blocked = await http()
      .post(`/seller/orders/${h.shipmentId}/accept`)
      .set('authorization', sellerA.auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ORDER_ON_HOLD');

    const queue = await http()
      .get('/admin/fraud/assessments?status=PENDING_REVIEW&pageSize=100')
      .set('authorization', support.auth);
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toContain(h.assessmentId);

    const approved = await http()
      .post(`/admin/fraud/assessments/${h.assessmentId}/approve`)
      .set('authorization', support.auth)
      .send({ note: 'Called customer, genuine' });
    expect(approved.status).toBe(201);
    expect(approved.body).toMatchObject({ reviewStatus: 'APPROVED', orderStatus: 'CONFIRMED' });
    // Second decision on the same item is refused.
    const again = await http()
      .post(`/admin/fraud/assessments/${h.assessmentId}/reject`)
      .set('authorization', support.auth)
      .send({});
    expect(again.status).toBe(409);

    const accepted = await http()
      .post(`/seller/orders/${h.shipmentId}/accept`)
      .set('authorization', sellerA.auth);
    expect(accepted.status).toBe(200);

    const audit = await prisma.auditLog.findMany({ where: { entityId: h.orderId } });
    expect(audit.map((a) => a.action)).toContain('fraud.review.approved');
  });

  it('manual review: reject cancels the order and restocks', async () => {
    const support = await staff('SUPPORT');
    const h = await heldOrder();
    const rejected = await http()
      .post(`/admin/fraud/assessments/${h.assessmentId}/reject`)
      .set('authorization', support.auth)
      .send({ note: 'Stolen card pattern' });
    expect(rejected.status).toBe(201);
    expect(rejected.body).toMatchObject({ reviewStatus: 'REJECTED', orderStatus: 'CANCELLED' });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: h.orderId } });
    expect(order).toMatchObject({ status: 'CANCELLED', fraudHold: false });
    const audit = await prisma.auditLog.findMany({
      where: { entityId: { in: [h.orderId, h.assessmentId] } },
    });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['fraud.review.rejected', 'admin.FraudAdmin.reject']),
    );
  });
});
