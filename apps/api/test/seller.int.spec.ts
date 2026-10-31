/**
 * Seller Central integration tests (M5.1–M5.4, M5.8) against a real Postgres and a real
 * OpenSearch (throwaway index). Run with `pnpm --filter @shopsphere/api test:int`
 * (DATABASE_URL migrated with `prisma migrate deploy`).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CategoryTreeService } from '../src/modules/catalog/category-tree.service';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { OpenSearchClient } from '../src/modules/search/opensearch.client';
import { SearchIndexerService } from '../src/modules/search/search-indexer.service';
import { makeGstin } from '../src/modules/seller/kyc-validation';
import { sellerUploadBodyParser } from '../src/modules/seller/seller.controller';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

const run = Date.now().toString(36);
process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m5_seller?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.SEARCH_INDEX = `products_seller_it_${run}`;
const INTERNAL = 'it-internal-token-0123456789';
process.env.CATALOG_INTERNAL_TOKEN = INTERNAL;

// 1x1 transparent PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PAN = 'ABCPK1234D';

describe('seller central (integration, real Postgres + OpenSearch)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let auth: string;
  let leafId: string;
  const leafPath = `it-${run}/tees-${run}`;
  const http = () => request(baseUrl);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(...sellerUploadBodyParser());
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    await app.get(SearchIndexerService).ensureIndex(true);

    const root = await prisma.category.create({
      data: { slug: `it-${run}`, name: `IT ${run}`, path: `it-${run}`, gstRateBp: 500 },
    });
    const leaf = await prisma.category.create({
      data: {
        slug: `tees-${run}`,
        name: 'Tees',
        path: leafPath,
        depth: 1,
        parentId: root.id,
      },
    });
    leafId = leaf.id;
    await prisma.attributeDefinition.createMany({
      data: [
        { categoryId: root.id, key: 'fabric', label: 'Fabric', position: 2 },
        {
          categoryId: leaf.id,
          key: 'color',
          label: 'Colour',
          type: 'COLOR',
          isVariant: true,
          filterable: true,
        },
        { categoryId: leaf.id, key: 'size', label: 'Size', isVariant: true, position: 1 },
      ],
    });
    app.get(CategoryTreeService).invalidate();

    const user = await prisma.user.create({ data: { name: 'Seller Tester' } });
    auth = `Bearer ${(await app.get(SessionService).create(user.id, false, {})).accessToken}`;
  });

  afterAll(async () => {
    const os = app.get(OpenSearchClient);
    await os.request('DELETE', `/${os.index}`).catch(() => undefined);
    await app.close();
  });

  const pickup = {
    name: 'Kiran Rao',
    phone: '9876543210',
    line1: '14 Industrial Estate',
    line2: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560058',
  };

  it('onboards: register → KYC validation → penny drop → submit → approval', async () => {
    await http().get('/seller/me').set('Authorization', auth).expect(404);
    const reg = await http()
      .post('/seller/register')
      .set('Authorization', auth)
      .send({ displayName: `Kiran Tees ${run}` })
      .expect(200);
    expect(reg.body).toMatchObject({
      status: 'DRAFT',
      missing: ['legalName', 'pan', 'gstin', 'bank', 'pickup'],
    });
    await http()
      .post('/seller/register')
      .set('Authorization', auth)
      .send({ displayName: 'x2' })
      .expect(409);

    const bad = await http()
      .patch('/seller/kyc')
      .set('Authorization', auth)
      .send({ pan: 'ABC123', gstin: makeGstin('27', PAN), pickup })
      .expect(422);
    expect(bad.body.code).toBe('KYC_INVALID');
    expect(new Set(bad.body.details.map((d: { field: string }) => d.field))).toEqual(
      new Set(['pan', 'gstin']),
    );

    const wrongState = await http()
      .patch('/seller/kyc')
      .set('Authorization', auth)
      .send({ pan: PAN, gstin: makeGstin('27', PAN), pickup })
      .expect(422);
    expect(wrongState.body.message).toMatch(/registered in Maharashtra/);

    await http()
      .patch('/seller/kyc')
      .set('Authorization', auth)
      .send({ legalName: 'Kiran Rao', pan: PAN.toLowerCase(), gstin: makeGstin('29', PAN), pickup })
      .expect(200);

    await http().post('/seller/kyc/submit').set('Authorization', auth).expect(422);
    const noAcct = await http()
      .post('/seller/kyc/bank')
      .set('Authorization', auth)
      .send({ holderName: 'Kiran Rao', accountNumber: '123456780000', ifsc: 'HDFC0001234' })
      .expect(422);
    expect(noAcct.body.code).toBe('BANK_VERIFY_FAILED');
    const mismatch = await http()
      .post('/seller/kyc/bank')
      .set('Authorization', auth)
      .send({ holderName: 'Kiran Rao', accountNumber: '123456789999', ifsc: 'HDFC0001234' })
      .expect(422);
    expect(mismatch.body.message).toMatch(/does not match/);
    const bank = await http()
      .post('/seller/kyc/bank')
      .set('Authorization', auth)
      .send({ holderName: 'Mr. Kiran Rao', accountNumber: '1234 5678 9012', ifsc: 'hdfc0001234' })
      .expect(200);
    expect(bank.body.bank).toMatchObject({
      accountLast4: '9012',
      ifsc: 'HDFC0001234',
      verified: true,
    });

    const submitted = await http()
      .post('/seller/kyc/submit')
      .set('Authorization', auth)
      .expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', missing: [] });
    await http()
      .patch('/seller/kyc')
      .set('Authorization', auth)
      .send({ legalName: 'X Y' })
      .expect(409);
    await http().get('/seller/categories').set('Authorization', auth).expect(403);

    await http().get('/seller/admin/applications').expect(401);
    const queue = await http()
      .get('/seller/admin/applications')
      .set('x-internal-token', INTERNAL)
      .expect(200);
    const app1 = queue.body.find((a: { id: string }) => a.id === reg.body.id);
    expect(app1).toBeDefined();
    const approved = await http()
      .post(`/seller/admin/applications/${reg.body.id}/approve`)
      .set('x-internal-token', INTERNAL)
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
    const seller = await prisma.seller.findUniqueOrThrow({ where: { id: approved.body.sellerId } });
    expect(seller).toMatchObject({ state: 'Karnataka', pincode: '560058', isFirstParty: false });
    // Fulfilment routes (/seller/orders etc.) authorise through seller_users.
    const link = await prisma.sellerUser.findFirstOrThrow({ where: { sellerId: seller.id } });
    expect(link.role).toBe('OWNER');
  });

  it('lists a product with variants and images; it shows up in catalog search', async () => {
    const cats = await http().get('/seller/categories').set('Authorization', auth).expect(200);
    expect(cats.body.map((c: { id: string }) => c.id)).toContain(leafId);
    const attrs = await http()
      .get(`/seller/categories/${leafId}/attributes`)
      .set('Authorization', auth)
      .expect(200);
    expect(attrs.body.map((a: { key: string }) => a.key)).toEqual(['color', 'size', 'fabric']);

    const media = await http()
      .post('/seller/media')
      .set('Authorization', auth)
      .send({ fileName: 'tee.png', contentType: 'image/png', dataBase64: PNG })
      .expect(201);
    await http()
      .post('/seller/media')
      .set('Authorization', auth)
      .send({ fileName: 'x.png', contentType: 'image/png', dataBase64: 'aGVsbG8=' })
      .expect(422);
    const img = await http().get(`/seller/media/${media.body.id}`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');

    const title = `Zephyrcotton Tee ${run}`;
    const invalid = await http()
      .post('/seller/listings')
      .set('Authorization', auth)
      .send({
        categoryId: leafId,
        title,
        brand: 'Kiran',
        variants: [{ attributes: { color: 'Red' }, price: 50_000, mrp: 40_000, stock: 1 }],
      })
      .expect(422);
    expect(invalid.body.code).toBe('LISTING_INVALID');

    const created = await http()
      .post('/seller/listings')
      .set('Authorization', auth)
      .send({
        categoryId: leafId,
        title,
        brand: `Kiran ${run}`,
        description: 'Soft combed cotton',
        bullets: ['180 GSM'],
        specs: { fabric: 'Cotton' },
        images: [media.body.id],
        variants: [
          {
            attributes: { color: 'Red', size: 'M' },
            skuCode: `KT-${run}-RM`,
            price: 49_900,
            mrp: 99_900,
            stock: 10,
          },
          { attributes: { color: 'Red', size: 'L' }, price: 49_900, mrp: 99_900, stock: 5 },
        ],
      })
      .expect(201);
    expect(created.body.skus).toHaveLength(2);
    expect(created.body.skus[0].code).toBe(`KT-${run}-RM`.toUpperCase());

    const search = await http()
      .get('/search')
      .query({ q: `Zephyrcotton ${run}` })
      .expect(200);
    expect(search.body.results.map((r: { slug: string }) => r.slug)).toContain(created.body.slug);
    const pdp = await http().get(`/products/${created.body.slug}`).expect(200);
    expect(JSON.stringify(pdp.body)).toContain(`/seller/media/${media.body.id}`);

    await http()
      .post('/seller/listings')
      .set('Authorization', auth)
      .send({
        categoryId: leafId,
        title: 'Dup code',
        brand: 'Kiran',
        variants: [{ attributes: {}, skuCode: `KT-${run}-RM`, price: 100, mrp: 100, stock: 1 }],
      })
      .expect(409);
  });

  it('edits price and stock inline', async () => {
    const inv = await http().get('/seller/inventory').set('Authorization', auth).expect(200);
    expect(inv.body.rows).toHaveLength(2);
    const row = inv.body.rows[0];
    const bad = await http()
      .patch(`/seller/offers/${row.offerId}`)
      .set('Authorization', auth)
      .send({ price: row.mrp + 1 })
      .expect(422);
    expect(bad.body.code).toBe('OFFER_INVALID');
    const ok = await http()
      .patch(`/seller/offers/${row.offerId}`)
      .set('Authorization', auth)
      .send({ price: 45_000, stock: 42 })
      .expect(200);
    expect(ok.body).toMatchObject({ price: 45_000, stock: 42 });
  });

  it('bulk upload: row-level report, dry run, then creates valid groups', async () => {
    const tpl = await http()
      .get('/seller/listings/bulk/template.csv')
      .query({ categoryId: leafId })
      .set('Authorization', auth)
      .expect(200);
    expect(tpl.text).toContain('attr:color');

    const csv = [
      'category_path,group_id,title,brand,description,bullets,sku_code,price,mrp,stock,image_urls,attr:color,attr:size,attr:fabric',
      `${leafPath},g1,Bulkfalcon Tee ${run},BulkCo,,,BF-${run}-1,399,799,7,,Blue,S,Cotton`,
      `${leafPath},g1,,,,,BF-${run}-2,399,799,3,,Blue,M,`,
      `${leafPath},g2,Broken ${run},BulkCo,,,BF-${run}-3,abc,799,1,,Blue,S,`,
      `nope/none,,Lost,BulkCo,,,BF-${run}-4,10,10,1,,,,`,
      `${leafPath},,Dup ${run},BulkCo,,,KT-${run}-RM,10,10,1,,,,`,
    ].join('\n');
    const body = { fileName: 'listings.csv', dataBase64: Buffer.from(csv).toString('base64') };

    const dry = await http()
      .post('/seller/listings/bulk')
      .set('Authorization', auth)
      .send({ ...body, dryRun: true })
      .expect(200);
    expect(dry.body).toMatchObject({
      totalRows: 5,
      validRows: 2,
      errorRows: 3,
      productsCreated: 0,
    });
    expect(dry.body.rows.map((r: { status: string }) => r.status)).toEqual([
      'OK',
      'OK',
      'ERROR',
      'ERROR',
      'ERROR',
    ]);
    expect(dry.body.rows[2].errors[0]).toMatchObject({ column: 'price' });
    expect(dry.body.rows[3].errors[0]).toMatchObject({ column: 'category_path' });
    expect(dry.body.rows[4].errors[0]).toMatchObject({
      column: 'sku_code',
      message: 'SKU code already exists',
    });

    const real = await http()
      .post('/seller/listings/bulk')
      .set('Authorization', auth)
      .send(body)
      .expect(200);
    expect(real.body).toMatchObject({ productsCreated: 1, skusCreated: 2 });
    const search = await http()
      .get('/search')
      .query({ q: `Bulkfalcon ${run}` })
      .expect(200);
    expect(search.body.total).toBe(1);

    const xlsx = await http()
      .post('/seller/listings/bulk')
      .set('Authorization', auth)
      .send({ fileName: 'bad.xlsx', dataBase64: Buffer.from('not a zip').toString('base64') })
      .expect(422);
    expect(xlsx.body.code).toBe('UPLOAD_INVALID');
  });

  it('dashboard summarises listings, including payout totals', async () => {
    const res = await http().get('/seller/dashboard').set('Authorization', auth).expect(200);
    expect(res.body).toMatchObject({
      sales: { last30DaysPaise: 0 },
      orders: { total: 0 },
      listings: { activeOffers: 4, outOfStock: 0 },
      payouts: { pendingPaise: 0, paidPaise: 0, lastPayoutAt: null },
    });
  });
});
