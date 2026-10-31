/**
 * Reviews + Q&A integration tests (M6.2, M6.3) against a real Postgres and OpenSearch (throwaway
 * index). Review photos go to an in-memory store. Run with
 * `corepack pnpm --filter @shopsphere/api exec jest test/review.int.spec.ts --testPathIgnorePatterns /node_modules/`
 * (DATABASE_URL migrated with `prisma migrate deploy`).
 */
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CategoryTreeService } from '../src/modules/catalog/category-tree.service';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { reviewUploadBodyParser } from '../src/modules/review/review.controller';
import { ReviewMediaStore } from '../src/modules/review/review-media.store';
import { OpenSearchClient } from '../src/modules/search/opensearch.client';
import { SearchIndexerService } from '../src/modules/search/search-indexer.service';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

const run = Date.now().toString(36);
process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m6_reviews?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SEARCH_INDEX = `products_reviews_it_${run}`;
const INTERNAL = 'it-internal-token-0123456789';
process.env.CATALOG_INTERNAL_TOKEN = INTERNAL;

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

class MemoryMediaStore extends ReviewMediaStore {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, bytes);
  }
  url(key: string): string {
    return `http://media.test/${key}`;
  }
}

describe('reviews and Q&A (integration, real Postgres + OpenSearch)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let productId: string;
  let sellerId: string;
  const store = new MemoryMediaStore();
  const http = () => request(baseUrl);

  async function login(name: string): Promise<{ id: string; auth: string }> {
    const user = await prisma.user.create({ data: { name } });
    const { accessToken } = await app.get(SessionService).create(user.id, false, {});
    return { id: user.id, auth: `Bearer ${accessToken}` };
  }

  /** Writes an order with one shipment straight to the tables (checkout is tested elsewhere). */
  async function order(userId: string, shipmentStatus: string): Promise<string> {
    const sku = await prisma.sku.findFirstOrThrow({ where: { productId } });
    const offer = await prisma.offer.findFirstOrThrow({ where: { skuId: sku.id } });
    const o = await prisma.order.create({
      data: {
        number: `OD${run}${Math.random().toString(36).slice(2, 8)}`,
        userId,
        checkoutId: randomUUID(),
        idempotencyKey: randomUUID(),
        status: shipmentStatus === 'DELIVERED' ? 'DELIVERED' : 'CONFIRMED',
        paymentMethod: 'COD',
        itemsPaise: 100_000n,
        mrpPaise: 120_000n,
        deliveryPaise: 0n,
        couponDiscountPaise: 0n,
        codFeePaise: 0n,
        totalPaise: 100_000n,
        storeBalancePaise: 0n,
        payablePaise: 100_000n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        igstPaise: 0n,
        address: {},
        shipToState: 'Karnataka',
        source: 'CART',
      },
    });
    const s = await prisma.shipment.create({
      data: {
        orderId: o.id,
        sellerId,
        sellerName: 'Review Seller',
        sellerState: 'Karnataka',
        fulfilledByShopSphere: false,
        deliveryOption: 'STANDARD',
        deliveryFeePaise: 0n,
        promisedDate: '2026-11-05',
        status: shipmentStatus,
        deliveredAt: shipmentStatus === 'DELIVERED' ? new Date() : null,
      },
    });
    await prisma.orderItem.create({
      data: {
        orderId: o.id,
        shipmentId: s.id,
        productId,
        skuId: sku.id,
        offerId: offer.id,
        sellerId,
        slug: `rv-${run}`,
        title: 'Review Product',
        qty: 1,
        unitPricePaise: 100_000n,
        mrpPaise: 120_000n,
        lineTotalPaise: 100_000n,
        discountPaise: 0n,
        gstRateBp: 1800,
        taxablePaise: 84_746n,
        cgstPaise: 7_627n,
        sgstPaise: 7_627n,
        igstPaise: 0n,
      },
    });
    return o.id;
  }

  async function buyer(name: string) {
    const u = await login(name);
    await order(u.id, 'DELIVERED');
    return u;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .overrideProvider(ReviewMediaStore)
      .useValue(store)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(...reviewUploadBodyParser());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    await app.get(SearchIndexerService).ensureIndex(true);

    const cat = await prisma.category.create({
      data: { slug: `rv-${run}`, name: 'RV test', path: `rv-${run}`, gstRateBp: 1800 },
    });
    app.get(CategoryTreeService).invalidate();
    const brand = await prisma.brand.create({ data: { slug: `rv-brand-${run}`, name: 'RV' } });
    const seller = await prisma.seller.create({
      data: {
        name: 'Review Seller',
        slug: `rv-seller-${run}`,
        pincode: '560001',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
    });
    sellerId = seller.id;
    const product = await prisma.product.create({
      data: {
        slug: `rv-${run}`,
        title: 'Review Product',
        brandId: brand.id,
        categoryId: cat.id,
        skus: { create: { code: `RV-${run}`, isDefault: true } },
      },
      include: { skus: true },
    });
    productId = product.id;
    await prisma.offer.create({
      data: { skuId: product.skus[0].id, sellerId, price: 100_000n, mrp: 120_000n, stockQty: 5 },
    });
  });

  afterAll(async () => {
    const os = app.get(OpenSearchClient);
    await os.request('DELETE', `/${os.index}`).catch(() => undefined);
    await app.close();
  });

  const review = (rating: number, extra: Record<string, unknown> = {}) => ({
    rating,
    title: `Rated ${rating} stars`,
    body: 'Battery lasts two days and the build quality is solid.',
    ...extra,
  });

  it('lets only verified buyers (DELIVERED) review, once', async () => {
    const stranger = await login('Stranger Danger');
    const notYet = await login('Waiting Wanda');
    await order(notYet.id, 'SHIPPED');

    for (const u of [stranger, notYet]) {
      const elig = await http()
        .get(`/products/${productId}/reviews/eligibility`)
        .set('Authorization', u.auth)
        .expect(200);
      expect(elig.body).toMatchObject({ eligible: false, reason: 'NOT_DELIVERED' });
      const res = await http()
        .post(`/products/${productId}/reviews`)
        .set('Authorization', u.auth)
        .send(review(5))
        .expect(403);
      expect(res.body.code).toBe('REVIEW_NOT_ELIGIBLE');
    }
    await http().post(`/products/${productId}/reviews`).send(review(5)).expect(401);

    const asha = await buyer('Asha Verma');
    expect(
      (
        await http()
          .get(`/products/${productId}/reviews/eligibility`)
          .set('Authorization', asha.auth)
          .expect(200)
      ).body,
    ).toMatchObject({ eligible: true, reason: null });

    const photo = await http()
      .post('/reviews/media')
      .set('Authorization', asha.auth)
      .send({ fileName: 'p.png', contentType: 'image/png', dataBase64: PNG })
      .expect(201);
    expect(store.objects.has(`reviews/${photo.body.id}.png`)).toBe(true);

    const created = await http()
      .post(`/products/${productId}/reviews`)
      .set('Authorization', asha.auth)
      .send(review(5, { imageIds: [photo.body.id] }))
      .expect(201);
    expect(created.body).toMatchObject({
      rating: 5,
      authorName: 'Asha V.',
      status: 'PUBLISHED',
      verifiedBuyer: true,
      images: [{ id: photo.body.id, url: `http://media.test/reviews/${photo.body.id}.png` }],
    });
    const dup = await http()
      .post(`/products/${productId}/reviews`)
      .set('Authorization', asha.auth)
      .send(review(4))
      .expect(409);
    expect(dup.body.code).toBe('REVIEW_EXISTS');
  });

  it('updates the aggregate, histogram and search document', async () => {
    const ravi = await buyer('Ravi Kumar');
    await http()
      .post(`/products/${productId}/reviews`)
      .set('Authorization', ravi.auth)
      .send(review(4))
      .expect(201);
    const meera = await buyer('Meera Iyer');
    await http()
      .post(`/products/${productId}/reviews`)
      .set('Authorization', meera.auth)
      .send(review(4))
      .expect(201);

    // 5 + 4 + 4 = 13 / 3 = 4.33 → 4.3
    const stats = await http().get(`/products/${productId}/reviews/stats`).expect(200);
    expect(stats.body).toMatchObject({
      rating: 4.3,
      ratingCount: 3,
      histogram: [0, 0, 0, 2, 1],
      withImages: 1,
    });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product).toMatchObject({ ratingX10: 43, ratingCount: 3 });
    const os = app.get(OpenSearchClient);
    const doc = (await os.request('GET', `/${os.index}/_doc/${productId}`)).body as {
      _source: { rating: number; ratingCount: number };
    };
    expect(doc._source).toMatchObject({ rating: 4.3, ratingCount: 3 });

    const fives = await http()
      .get(`/products/${productId}/reviews?stars=5&withImages=true`)
      .expect(200);
    expect(fives.body.total).toBe(1);
    const low = await http().get(`/products/${productId}/reviews?sort=rating_asc&limit=1`).expect(200);
    expect(low.body.items[0].rating).toBe(4);
    expect(low.body.nextCursor).toBe('1');
  });

  it('counts helpful votes idempotently', async () => {
    const target = (await http().get(`/products/${productId}/reviews?stars=5`)).body.items[0];
    const voter = await login('Voter Vic');
    for (let i = 0; i < 3; i++) {
      const res = await http()
        .put(`/reviews/${target.id}/vote`)
        .set('Authorization', voter.auth)
        .expect(200);
      expect(res.body).toEqual({ reviewId: target.id, helpfulCount: 1, voted: true });
    }
    // Concurrent duplicates still count once.
    const other = await login('Voter Val');
    await Promise.all(
      Array.from({ length: 5 }, () =>
        http().put(`/reviews/${target.id}/vote`).set('Authorization', other.auth).expect(200),
      ),
    );
    expect(
      (await prisma.review.findUniqueOrThrow({ where: { id: target.id } })).helpfulCount,
    ).toBe(2);
    for (let i = 0; i < 2; i++) {
      const res = await http()
        .delete(`/reviews/${target.id}/vote`)
        .set('Authorization', voter.auth)
        .expect(200);
      expect(res.body).toMatchObject({ helpfulCount: 1, voted: false });
    }
    const author = await prisma.review.findUniqueOrThrow({ where: { id: target.id } });
    const own = await app.get(SessionService).create(author.userId, false, {});
    await http()
      .put(`/reviews/${target.id}/vote`)
      .set('Authorization', `Bearer ${own.accessToken}`)
      .expect(422);
  });

  it('queues auto-flagged and reported reviews for moderation', async () => {
    const spammer = await buyer('Sam Spam');
    const flagged = await http()
      .post(`/products/${productId}/reviews`)
      .set('Authorization', spammer.auth)
      .send(review(1, { body: 'Cheaper at www.dodgy-deals.xyz, trust me!!' }))
      .expect(201);
    expect(flagged.body.status).toBe('PENDING');

    const queue = await http()
      .get('/admin/reviews?status=PENDING')
      .set('x-internal-token', INTERNAL)
      .expect(200);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(flagged.body.id);
    await http().get('/admin/reviews').expect(401);

    // Still 3 published reviews: pending ones are not counted.
    expect((await http().get(`/products/${productId}/reviews/stats`)).body.ratingCount).toBe(3);
    const approved = await http()
      .post(`/admin/reviews/${flagged.body.id}/moderate`)
      .set('x-internal-token', INTERNAL)
      .send({ action: 'approve', note: 'ok' })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'PUBLISHED', moderationNote: 'ok' });
    // (5+4+4+1)/4 = 3.5
    expect((await http().get(`/products/${productId}/reviews/stats`)).body).toMatchObject({
      rating: 3.5,
      ratingCount: 4,
    });

    const target = (await http().get(`/products/${productId}/reviews?stars=4`)).body.items[0];
    for (let i = 0; i < 3; i++) {
      const u = await login(`Reporter ${i}`);
      for (let j = 0; j < 2; j++)
        await http()
          .post(`/reviews/${target.id}/report`)
          .set('Authorization', u.auth)
          .send({ reason: 'FAKE' })
          .expect(200);
    }
    const reported = await http()
      .get(`/admin/reviews/${target.id}`)
      .set('x-internal-token', INTERNAL)
      .expect(200);
    expect(reported.body).toMatchObject({
      status: 'PENDING',
      reportCount: 3,
      moderationNote: 'REPORTED',
    });
    expect((await http().get(`/products/${productId}/reviews/stats`)).body.ratingCount).toBe(3);
  });

  it('drains the aggregate queue and serves summary candidates', async () => {
    await prisma.product.update({ where: { id: productId }, data: { ratingX10: 0, ratingCount: 0 } });
    await prisma.reviewAggregateQueue.create({ data: { productId } });
    const res = await http()
      .post('/reviews/internal/refresh-aggregates')
      .set('x-internal-token', INTERNAL)
      .expect(200);
    expect(res.body.products).toBeGreaterThanOrEqual(1);
    // Published now: 5, 4, 1 → 3.33 → 3.3
    expect(await prisma.product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({
      ratingX10: 33,
      ratingCount: 3,
    });
    expect(await prisma.reviewAggregateQueue.count({ where: { productId } })).toBe(0);

    const cands = await http()
      .get('/reviews/internal/summary-candidates?limit=100')
      .set('x-internal-token', INTERNAL)
      .expect(200);
    const mine = cands.body.find((c: { productId: string }) => c.productId === productId);
    expect(mine).toMatchObject({ reviewCount: 3, productTitle: 'Review Product' });
    await http()
      .put(`/reviews/internal/summaries/${productId}`)
      .set('x-internal-token', INTERNAL)
      .send({
        summary: 'Buyers like the battery.',
        themes: [{ label: 'Battery', sentiment: 'positive', mentions: 3 }],
        source: 'offline',
        model: null,
        reviewCount: 3,
      })
      .expect(200);
    const after = await http()
      .get('/reviews/internal/summary-candidates?limit=100')
      .set('x-internal-token', INTERNAL);
    expect(after.body.some((c: { productId: string }) => c.productId === productId)).toBe(false);
    expect((await http().get(`/products/${productId}/reviews/stats`)).body.summary).toMatchObject({
      summary: 'Buyers like the battery.',
      source: 'offline',
    });
  });

  it('runs Q&A: ask, search, customer and seller answers', async () => {
    const asker = await login('Curious Cat');
    const q = await http()
      .post(`/products/${productId}/questions`)
      .set('Authorization', asker.auth)
      .send({ body: 'Does it support fast charging?' })
      .expect(201);
    await http()
      .post(`/products/${productId}/questions`)
      .set('Authorization', asker.auth)
      .send({ body: 'Is the box water resistant?' })
      .expect(201);

    const owner = await login('Seller Owner');
    await prisma.sellerAccount.create({
      data: { userId: owner.id, sellerId, displayName: 'Review Seller', status: 'APPROVED' },
    });
    const pending = await http()
      .get('/seller/questions?status=unanswered')
      .set('Authorization', owner.auth)
      .expect(200);
    expect(pending.body.items.map((i: { id: string }) => i.id)).toContain(q.body.id);
    const sellerAns = await http()
      .post(`/seller/questions/${q.body.id}/answers`)
      .set('Authorization', owner.auth)
      .send({ body: 'Yes, 33 W wired charging.' })
      .expect(201);
    expect(sellerAns.body).toMatchObject({ isSeller: true, authorName: 'Review Seller' });

    const otherSeller = await prisma.seller.create({
      data: { name: 'Other', slug: `rv-other-${run}`, pincode: '1', city: 'x', state: 'y' },
    });
    const otherOwner = await login('Other Owner');
    await prisma.sellerAccount.create({
      data: { userId: otherOwner.id, sellerId: otherSeller.id, displayName: 'O', status: 'APPROVED' },
    });
    const denied = await http()
      .post(`/seller/questions/${q.body.id}/answers`)
      .set('Authorization', otherOwner.auth)
      .send({ body: 'Nope' })
      .expect(403);
    expect(denied.body.code).toBe('NOT_YOUR_PRODUCT');

    const owner2 = await buyer('Buyer Bea');
    const custAns = await http()
      .post(`/questions/${q.body.id}/answers`)
      .set('Authorization', owner2.auth)
      .send({ body: 'Charges to full in an hour.' })
      .expect(201);
    expect(custAns.body).toMatchObject({ isSeller: false, verifiedBuyer: true });

    const found = await http().get(`/products/${productId}/questions?q=33 w`).expect(200);
    expect(found.body.total).toBe(1);
    expect(found.body.items[0]).toMatchObject({ id: q.body.id, answerCount: 2 });
    expect(found.body.items[0].answers[0].isSeller).toBe(true);
    const all = await http().get(`/products/${productId}/questions`).expect(200);
    expect(all.body.total).toBe(2);
    const answered = await http()
      .get('/seller/questions?status=unanswered')
      .set('Authorization', owner.auth);
    expect(answered.body.items.map((i: { id: string }) => i.id)).not.toContain(q.body.id);
  });
});
