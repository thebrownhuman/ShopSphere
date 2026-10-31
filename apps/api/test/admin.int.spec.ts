/**
 * Admin console + promotions integration tests (M6.5–M6.7) against a real Postgres.
 * Run with `pnpm --filter @shopsphere/api test:int` (DATABASE_URL migrated with
 * `prisma migrate deploy`). OpenSearch is not required (reindex failures are tolerated).
 */
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { StaffRole } from '@shopsphere/types';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

const run = Date.now().toString(36);
process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m6_admin?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SEARCH_INDEX = `products_admin_it_${run}`;

describe('admin console (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const tokens: Partial<Record<StaffRole | 'NONE', string>> = {};
  const userIds: Partial<Record<StaffRole | 'NONE', string>> = {};
  let offerId: string;
  let productId: string;
  const http = () => request(baseUrl);
  const as = (who: StaffRole | 'NONE') => `Bearer ${tokens[who]}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    const sessions = app.get(SessionService);

    for (const who of ['NONE', 'SUPER_ADMIN', 'CATALOG', 'SUPPORT', 'FINANCE'] as const) {
      const user = await prisma.user.create({
        data: {
          name: `${who} ${run}`,
          identities: { create: { type: 'email', value: `${who.toLowerCase()}-${run}@it.test` } },
        },
      });
      if (who !== 'NONE') await prisma.staffRole.create({ data: { userId: user.id, role: who } });
      userIds[who] = user.id;
      tokens[who] = (await sessions.create(user.id, false, {})).accessToken;
    }

    const category = await prisma.category.create({
      data: { slug: `adm-${run}`, name: 'Admin IT', path: `adm-${run}`, gstRateBp: 1800 },
    });
    const brand = await prisma.brand.create({ data: { slug: `adm-${run}`, name: 'AdmBrand' } });
    const seller = await prisma.seller.create({
      data: {
        name: `Adm Seller ${run}`,
        slug: `adm-seller-${run}`,
        pincode: '560001',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
    });
    const product = await prisma.product.create({
      data: {
        slug: `adm-phone-${run}`,
        title: `Admin Phone ${run}`,
        brandId: brand.id,
        categoryId: category.id,
        skus: { create: { code: `ADM-${run}`, isDefault: true } },
      },
      include: { skus: true },
    });
    productId = product.id;
    offerId = (
      await prisma.offer.create({
        data: {
          skuId: product.skus[0].id,
          sellerId: seller.id,
          price: 1_000_000n,
          mrp: 1_500_000n,
          stockQty: 100,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const lastAudit = (action: string) =>
    prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } });

  describe('RBAC guards', () => {
    it('401 without a token, 403 for non-staff', async () => {
      await http().get('/admin/me').expect(401);
      await http().get('/admin/me').set('Authorization', as('NONE')).expect(403);
    });

    it('roles gate each area; super-admin passes everywhere', async () => {
      await http().get('/admin/users').set('Authorization', as('CATALOG')).expect(403);
      await http().get('/admin/users').set('Authorization', as('SUPPORT')).expect(200);
      await http().get('/admin/promotions/deals').set('Authorization', as('FINANCE')).expect(403);
      await http().get('/admin/audit').set('Authorization', as('SUPPORT')).expect(403);
      await http().get('/admin/audit').set('Authorization', as('FINANCE')).expect(200);
      await http()
        .post(`/admin/orders/${randomUUID()}/refunds`)
        .set('Authorization', as('SUPPORT'))
        .send({ amountPaise: 100, note: 'not allowed' })
        .expect(403);
      await http()
        .put(`/admin/users/${userIds.SUPPORT}/roles`)
        .set('Authorization', as('SUPPORT'))
        .send({ roles: ['SUPER_ADMIN'] })
        .expect(403);
      for (const path of [
        '/admin/users',
        '/admin/audit',
        '/admin/promotions/deals',
        '/admin/home/sections',
      ])
        await http().get(path).set('Authorization', as('SUPER_ADMIN')).expect(200);
      const me = await http().get('/admin/me').set('Authorization', as('FINANCE')).expect(200);
      expect(me.body.roles).toEqual(['FINANCE']);
    });

    it('a denied request leaves no audit row', async () => {
      const before = await prisma.auditLog.count({ where: { actorId: userIds.SUPPORT } });
      await http()
        .post('/admin/promotions/deals')
        .set('Authorization', as('SUPPORT'))
        .send({})
        .expect(403);
      expect(await prisma.auditLog.count({ where: { actorId: userIds.SUPPORT } })).toBe(before);
    });
  });

  describe('every admin mutation is audited', () => {
    const now = Date.now();
    const window = {
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
    };

    it.each<[string, StaffRole, () => [string, string, object], string]>([
      [
        'suspend user',
        'SUPPORT',
        () => ['post', `/admin/users/${userIds.NONE}/status`, { status: 'suspended' }],
        'admin.Users.status',
      ],
      [
        'grant roles',
        'SUPER_ADMIN',
        () => ['put', `/admin/users/${userIds.NONE}/roles`, { roles: ['SUPPORT'] }],
        'admin.Users.roles',
      ],
      [
        'block product',
        'CATALOG',
        () => [
          'post',
          `/admin/products/${productId}/status`,
          { status: 'BLOCKED', reason: 'counterfeit report' },
        ],
        'admin.Catalog.status',
      ],
      [
        'unblock product',
        'CATALOG',
        () => [
          'post',
          `/admin/products/${productId}/status`,
          { status: 'ACTIVE', reason: 'cleared' },
        ],
        'admin.Catalog.status',
      ],
      [
        'create coupon',
        'CATALOG',
        () => [
          'post',
          '/admin/promotions/coupons',
          { code: `IT${run}`, type: 'PERCENT', value: 1000, ...window },
        ],
        'admin.Promotions.createCoupon',
      ],
      [
        'create bank offer',
        'FINANCE',
        () => [
          'post',
          '/admin/promotions/bank-offers',
          { title: `IT bank ${run}`, percentBp: 500, ...window },
        ],
        'admin.Promotions.createBankOffer',
      ],
      [
        'create home section',
        'CATALOG',
        () => [
          'post',
          '/admin/home/sections',
          {
            type: 'PRODUCT_CAROUSEL',
            title: `IT row ${run}`,
            dataSource: { query: { q: 'phone' } },
          },
        ],
        'admin.HomeCms.create',
      ],
    ])('%s', async (_, who, req, action) => {
      const [method, path, body] = req();
      const res = await (http() as unknown as Record<string, (p: string) => request.Test>)
        [method](path)
        .set('Authorization', as(who))
        .send(body);
      expect(res.status).toBeLessThan(300);
      const row = await lastAudit(action);
      expect(row).toMatchObject({ actorId: userIds[who], actorType: 'admin' });
      expect(row!.createdAt.getTime()).toBeGreaterThan(now - 1000);
    });

    it('home reorder + delete are audited; suspended user is signed out', async () => {
      const list = await http()
        .get('/admin/home/sections')
        .set('Authorization', as('CATALOG'))
        .expect(200);
      const ids = (list.body as { id: string }[]).map((s) => s.id).reverse();
      await http()
        .post('/admin/home/sections/reorder')
        .set('Authorization', as('CATALOG'))
        .send({ ids })
        .expect(200);
      expect(await lastAudit('admin.HomeCms.reorder')).not.toBeNull();
      await http()
        .delete(`/admin/home/sections/${ids[0]}`)
        .set('Authorization', as('CATALOG'))
        .expect(200);
      expect((await lastAudit('admin.HomeCms.remove'))?.entityId).toBe(ids[0]);
      // Suspended in the first case: their session was revoked.
      await http().get('/admin/me').set('Authorization', as('NONE')).expect(401);
    });
  });

  describe('lightning deals', () => {
    it('created deal shows on the home preview with real % claimed', async () => {
      const res = await http()
        .post('/admin/promotions/deals')
        .set('Authorization', as('CATALOG'))
        .send({
          offerId,
          title: `IT Deal ${run}`,
          dealPricePaise: 799_900,
          quantityCap: 10,
          startsAt: new Date(Date.now() - 1000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        })
        .expect(201);
      expect((await lastAudit('admin.Promotions.createDeal'))?.entityId).toBe(res.body.id);
      await prisma.homeSection.create({
        data: {
          type: 'DEAL_ROW',
          title: `Lightning ${run}`,
          dataSource: { lightningDeals: true },
          position: 1,
        },
      });
      const home = await http()
        .get('/admin/home/preview')
        .set('Authorization', as('CATALOG'))
        .expect(200);
      const row = (home.body.sections as { title: string; deals?: unknown[] }[]).find(
        (s) => s.title === `Lightning ${run}`,
      );
      expect(row?.deals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            claimedPercent: 0,
            product: expect.objectContaining({
              title: `IT Deal ${run}`,
              pricing: expect.objectContaining({ price: 799_900, mrp: 1_500_000 }),
            }),
          }),
        ]),
      );
    });

    it('rejects a deal price at or above the selling price', async () => {
      await http()
        .post('/admin/promotions/deals')
        .set('Authorization', as('CATALOG'))
        .send({
          offerId,
          dealPricePaise: 1_000_000,
          quantityCap: 1,
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 60_000).toISOString(),
        })
        .expect(422);
    });

    it('quantity cap holds under concurrent claims', async () => {
      const promos = app.get(PromotionsService);
      const deal = await promos.createDeal({
        offerId,
        dealPricePaise: 500_000,
        quantityCap: 5,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const results = await Promise.allSettled(
        Array.from({ length: 25 }, () =>
          prisma.$transaction((tx) => promos.claim(tx, randomUUID(), deal.id, 1)),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const soldOut = results.filter(
        (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'DEAL_SOLD_OUT',
      ).length;
      expect(ok).toBe(5);
      expect(soldOut).toBe(20);
      const row = await prisma.lightningDeal.findUniqueOrThrow({ where: { id: deal.id } });
      expect(row.claimedQty).toBe(5);
      expect(await prisma.dealClaim.count({ where: { dealId: deal.id } })).toBe(5);
      expect((await promos.liveDeals()).some((d) => d.id === deal.id)).toBe(false);
    });
  });

  describe('bank offers', () => {
    it('apply only to ShopSphere Bank payments', async () => {
      const promos = app.get(PromotionsService);
      await prisma.bankOffer.updateMany({ data: { active: false } });
      const offer = await promos.saveBankOffer({
        title: `10% bank ${run}`,
        percentBp: 1000,
        maxDiscountPaise: 50_000,
        minOrderPaise: 0,
        startsAt: new Date(Date.now() - 1000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        active: true,
      });
      expect(await promos.bankOfferFor({ type: 'ONLINE', provider: 'bank' }, 200_000)).toEqual({
        id: offer.id,
        title: offer.title,
        discountPaise: 20_000,
      });
      expect(
        await promos.bankOfferFor({ type: 'ONLINE', provider: 'razorpay' }, 200_000),
      ).toBeNull();
      expect(await promos.bankOfferFor({ type: 'COD' }, 200_000)).toBeNull();
      expect(await promos.bankOfferFor(null, 200_000)).toBeNull();
    });
  });

  describe('orders + refunds', () => {
    it('finance refund on an unpaid order fails without an audit row', async () => {
      const before = await prisma.auditLog.count({ where: { actorId: userIds.FINANCE } });
      const res = await http()
        .post(`/admin/orders/${randomUUID()}/refunds`)
        .set('Authorization', as('FINANCE'))
        .send({ amountPaise: 100, note: 'goodwill' });
      expect(res.status).toBe(404);
      expect(await prisma.auditLog.count({ where: { actorId: userIds.FINANCE } })).toBe(before);
    });
  });
});
