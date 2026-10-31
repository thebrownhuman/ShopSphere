/**
 * Cart integration tests against a real Postgres (row locks and unique indexes are the point).
 * Uses DATABASE_URL (migrated: `prisma migrate deploy`); Redis is faked.
 * Run with `pnpm --filter @shopsphere/api test:int`.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/shopsphere_m3?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.CART_MAX_LINES = '4';

const run = Date.now().toString(36);
const JSON_HDR = { 'content-type': 'application/json' };

describe('cart (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessions: SessionService;
  const sku: Record<string, string> = {};
  const offer: Record<string, string> = {};
  let sellerA: string;
  let sellerB: string;

  const http = () => request(app.getHttpServer());
  const cookieOf = (res: request.Response): string | undefined =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('guest_cart='))
      ?.split(';')[0];

  function guestAdd(body: object, cookie?: string) {
    const req = http().post('/cart/items').set(JSON_HDR);
    if (cookie) req.set('cookie', cookie);
    return req.send(body);
  }

  async function newUser() {
    const user = await prisma.user.create({ data: { name: 'Cart Tester' } });
    const tokens = await sessions.create(user.id, false, {});
    return { id: user.id, auth: `Bearer ${tokens.accessToken}` };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    sessions = app.get(SessionService);

    await prisma.pincode.upsert({
      where: { pincode: '744101' },
      create: { pincode: '744101', city: 'Port Blair', state: 'Andaman', serviceable: false },
      update: { serviceable: false },
    });
    const cat = await prisma.category.create({
      data: { slug: `cart-${run}`, name: 'Cart test', path: `cart-${run}` },
    });
    const brand = await prisma.brand.create({ data: { slug: `brand-${run}`, name: 'Brandy' } });
    const seller = (n: string) =>
      prisma.seller.create({
        data: { name: `Seller ${n}`, slug: `seller-${n}-${run}`, pincode: '560001', city: 'Bengaluru', state: 'KA' },
      });
    sellerA = (await seller('a')).id;
    sellerB = (await seller('b')).id;
    const product = await prisma.product.create({
      data: { slug: `cart-product-${run}`, title: 'Cart Test Phone', brandId: brand.id, categoryId: cat.id },
    });
    // name -> [stock, maxPerOrder, status]
    const specs: Record<string, [number, number, string]> = {
      std: [50, 5, 'ACTIVE'],
      low: [2, 5, 'ACTIVE'],
      big: [100, 50, 'ACTIVE'],
      off: [10, 5, 'INACTIVE'],
      m1: [50, 5, 'ACTIVE'],
      m2: [50, 5, 'ACTIVE'],
      m3: [50, 5, 'ACTIVE'],
      m4: [50, 5, 'ACTIVE'],
      m5: [50, 5, 'ACTIVE'],
    };
    let pos = 0;
    for (const [name, [stockQty, maxPerOrder, status]] of Object.entries(specs)) {
      const s = await prisma.sku.create({
        data: { productId: product.id, code: `${name}-${run}`, attributes: { color: name }, position: pos++ },
      });
      sku[name] = s.id;
      const o = await prisma.offer.create({
        data: { skuId: s.id, sellerId: sellerA, price: 20_000n, mrp: 25_000n, stockQty, maxPerOrder, status },
      });
      offer[name] = o.id;
    }
    // A pricier second seller on `std`: the buy box stays with seller A.
    await prisma.offer.create({
      data: { skuId: sku.std, sellerId: sellerB, price: 21_000n, mrp: 25_000n, stockQty: 50, maxPerOrder: 5 },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('guest add sets a signed guest_cart cookie and the server computes totals', async () => {
    const res = await guestAdd({ sku: sku.std, qty: 2, price: 1, unitPrice: 1 }).expect(201);
    const cookie = cookieOf(res);
    expect(cookie).toMatch(/^guest_cart=[\w-]{32}\./);
    expect(([] as string[]).concat(res.headers['set-cookie']).join(';')).toMatch(/HttpOnly/i);
    const line = res.body.cart.groups[0].lines[0];
    expect(line).toMatchObject({ sellerId: sellerA, qty: 2, unitPrice: 20_000, lineTotal: 40_000 });
    expect(res.body.cart.summary).toMatchObject({
      subtotal: 40_000,
      deliveryFee: 4_000,
      total: 44_000,
      freeDeliveryRemaining: 9_900,
      itemCount: 2,
    });

    const again = await http().get('/cart').set('cookie', cookie!).expect(200);
    expect(again.body.summary.subtotal).toBe(40_000);
    // Without the cookie there is no cart.
    expect((await http().get('/cart').expect(200)).body.groups).toEqual([]);
    // A forged cookie is ignored.
    const forged = cookie!.replace(/\.(.)/, (_, c) => `.${c === 'A' ? 'B' : 'A'}`);
    expect((await http().get('/cart').set('cookie', forged).expect(200)).body.groups).toEqual([]);
  });

  it('enforces limits: per-order, stock, 10 per item, line count, serviceability, live offer', async () => {
    const c = cookieOf(await guestAdd({ sku: sku.std, qty: 1 }).expect(201))!;
    const limit = await guestAdd({ sku: sku.std, qty: 5 }, c).expect(409);
    expect(limit.body).toMatchObject({ code: 'QTY_LIMIT', message: 'You can buy only 5 of this item' });
    const low = await guestAdd({ sku: sku.low, qty: 3 }, c).expect(409);
    expect(low.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', message: 'Only 2 available' });
    const ten = await guestAdd({ sku: sku.big, qty: 11 }, c).expect(409);
    expect(ten.body).toMatchObject({ code: 'QTY_LIMIT', details: { limit: 10 } });
    const pin = await guestAdd({ sku: sku.m1, qty: 1, pincode: '744101' }, c).expect(422);
    expect(pin.body).toMatchObject({ code: 'NOT_SERVICEABLE', message: 'Not deliverable to 744101' });
    expect((await guestAdd({ sku: sku.off, qty: 1 }, c).expect(422)).body.code).toBe('OFFER_UNAVAILABLE');
    expect((await guestAdd({ sku: sku.std, sellerId: sellerB, qty: 1 }, c).expect(201)).body.cart.summary.lineCount).toBe(2);
    await guestAdd({ sku: sku.m1, qty: 1 }, c).expect(201);
    await guestAdd({ sku: sku.m2, qty: 1 }, c).expect(201);
    const full = await guestAdd({ sku: sku.m3, qty: 1 }, c).expect(409);
    expect(full.body.code).toBe('CART_FULL');
    // Raising qty past the limit via PATCH is refused too; lowering is fine.
    const cart = (await http().get('/cart').set('cookie', c)).body;
    const lineId = cart.groups.flatMap((g: { lines: { id: string; skuId: string; sellerId: string }[] }) => g.lines)
      .find((l: { skuId: string; sellerId: string }) => l.skuId === sku.std && l.sellerId === sellerA).id;
    await http().patch(`/cart/items/${lineId}`).set('cookie', c).send({ qty: 6 }).expect(409);
    await http().patch(`/cart/items/${lineId}`).set('cookie', c).send({ qty: 4 }).expect(200);
  });

  it('rejects non-JSON POSTs (CSRF: forces a CORS preflight)', async () => {
    await http().post('/cart/items').type('form').send('sku=x&qty=1').expect(415);
  });

  it('two tabs adding concurrently: serialised, never over the limit', async () => {
    const c = cookieOf(await guestAdd({ sku: sku.std, qty: 1 }).expect(201))!;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => guestAdd({ sku: sku.std, qty: 1 }, c)),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((s) => s === 201)).toHaveLength(4);
    expect(codes.filter((s) => s === 409)).toHaveLength(4);
    const cart = (await http().get('/cart').set('cookie', c)).body;
    expect(cart.groups[0].lines[0].qty).toBe(5);
    expect(cart.version).toBe(5);
  });

  it('two tabs adding different items concurrently respect the line limit', async () => {
    const c = cookieOf(await guestAdd({ sku: sku.m1, qty: 1 }).expect(201))!;
    const results = await Promise.all(
      ['m2', 'm3', 'm4', 'm5'].map((k) => guestAdd({ sku: sku[k], qty: 1 }, c)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409 && r.body.code === 'CART_FULL')).toHaveLength(1);
    expect((await http().get('/cart').set('cookie', c)).body.summary.lineCount).toBe(4);
  });

  it('one tab deletes while another edits: no errors leak, final state consistent', async () => {
    const add = await guestAdd({ sku: sku.std, qty: 1 }).expect(201);
    const c = cookieOf(add)!;
    const id = add.body.lineId;
    const [del, del2, patch] = await Promise.all([
      http().delete(`/cart/items/${id}`).set('cookie', c),
      http().delete(`/cart/items/${id}`).set('cookie', c),
      http().patch(`/cart/items/${id}`).set('cookie', c).send({ qty: 3 }),
    ]);
    expect(del.status).toBe(200);
    expect(del2.status).toBe(200);
    expect([200, 404]).toContain(patch.status);
    if (patch.status === 404) expect(patch.body.code).toBe('LINE_NOT_FOUND');
    const cart = (await http().get('/cart').set('cookie', c)).body;
    expect(cart.groups).toEqual([]);
    expect(cart.summary.total).toBe(0);
  });

  it('flags price and stock changes against the snapshot', async () => {
    const add = await guestAdd({ sku: sku.m4, qty: 3 }).expect(201);
    const c = cookieOf(add)!;
    await prisma.offer.update({ where: { id: offer.m4 }, data: { price: 18_000n, stockQty: 2 } });
    try {
      const line = (await http().get('/cart').set('cookie', c)).body.groups[0].lines[0];
      expect(line).toMatchObject({
        priceChange: { from: 20_000, to: 18_000 },
        stockChange: 'LIMITED',
        maxQty: 2,
        lineTotal: 36_000,
      });
    } finally {
      await prisma.offer.update({ where: { id: offer.m4 }, data: { price: 20_000n, stockQty: 50 } });
    }
  });

  it('save for later and move back to cart', async () => {
    const add = await guestAdd({ sku: sku.m5, qty: 2 }).expect(201);
    const c = cookieOf(add)!;
    const saved = await http()
      .post(`/cart/items/${add.body.lineId}/save-for-later`)
      .set('cookie', c)
      .send({})
      .expect(200);
    expect(saved.body.groups).toEqual([]);
    expect(saved.body.saved[0]).toMatchObject({ skuId: sku.m5, price: 20_000, inStock: true });
    const back = await http()
      .post(`/cart/saved/${saved.body.saved[0].id}/move-to-cart`)
      .set('cookie', c)
      .send({})
      .expect(200);
    expect(back.body.saved).toEqual([]);
    expect(back.body.groups[0].lines[0]).toMatchObject({ skuId: sku.m5, qty: 1 });
  });

  it('merges the guest cart on password sign-in: sums qty, caps at limits, clears cookie', async () => {
    const email = `cart-${run}@example.test`;
    const user = await prisma.user.create({
      data: {
        name: 'Merger',
        passwordHash: await hash('Correct-horse-9'),
        identities: { create: { type: 'email', value: email, verifiedAt: new Date() } },
      },
    });
    const userAuth = `Bearer ${(await sessions.create(user.id, false, {})).accessToken}`;
    await http().post('/cart/items').set('authorization', userAuth).send({ sku: sku.std, qty: 3 }).expect(201);
    await http().post('/cart/items').set('authorization', userAuth).send({ sku: sku.m1, qty: 1 }).expect(201);

    const g = cookieOf(await guestAdd({ sku: sku.std, qty: 4 }).expect(201))!;
    await guestAdd({ sku: sku.m2, qty: 2 }, g).expect(201);

    const login = await http()
      .post('/auth/login')
      .set('cookie', g)
      .send({ identifier: email, password: 'Correct-horse-9' })
      .expect(200);
    expect(login.body.status).toBe('authenticated');
    expect(([] as string[]).concat(login.headers['set-cookie']).join(';')).toMatch(/guest_cart=;/);

    const cart = (
      await http().get('/cart').set('authorization', `Bearer ${login.body.accessToken}`).expect(200)
    ).body;
    const qty = Object.fromEntries(
      cart.groups.flatMap((gr: { lines: { skuId: string; qty: number }[] }) => gr.lines).map((l: { skuId: string; qty: number }) => [l.skuId, l.qty]),
    );
    expect(qty).toEqual({ [sku.std]: 5, [sku.m1]: 1, [sku.m2]: 2 });
    // The old guest cookie no longer reaches a cart.
    expect((await http().get('/cart').set('cookie', g)).body.groups).toEqual([]);
  });

  it('concurrent merges (two tabs signing in) merge once', async () => {
    const u = await newUser();
    const g = cookieOf(await guestAdd({ sku: sku.big, qty: 7 }).expect(201))!;
    await Promise.all([
      http().get('/cart').set('authorization', u.auth).set('cookie', g),
      http().get('/cart').set('authorization', u.auth).set('cookie', g),
    ]);
    const cart = (await http().get('/cart').set('authorization', u.auth)).body;
    expect(cart.groups[0].lines[0].qty).toBe(7);
  });

  it('wishlist CRUD and move to cart (signed in only)', async () => {
    await http().get('/wishlist').expect(401);
    const u = await newUser();
    const added = await http().post('/wishlist/items').set('authorization', u.auth).send({ sku: sku.m3 }).expect(201);
    expect(added.body.items).toHaveLength(1);
    await http().post('/wishlist/items').set('authorization', u.auth).send({ sku: sku.m3 }).expect(201);
    const list = (await http().get('/wishlist').set('authorization', u.auth)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ skuId: sku.m3, price: 20_000, inStock: true });
    const moved = await http()
      .post(`/wishlist/items/${list.items[0].id}/move-to-cart`)
      .set('authorization', u.auth)
      .send({})
      .expect(200);
    expect(moved.body.groups[0].lines[0].skuId).toBe(sku.m3);
    expect((await http().get('/wishlist').set('authorization', u.auth)).body.items).toEqual([]);
  });

  it('an invalid bearer token is a 401, not a silent guest cart', async () => {
    await http().get('/cart').set('authorization', 'Bearer nope').expect(401);
  });
});
