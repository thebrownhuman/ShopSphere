import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './app.module';
import { CourierService } from './courier.service';
import { rateFor, serviceable, zoneFor } from './lanes';

const KEY = { 'x-api-key': 'cs_test_api_key' };

describe('lanes', () => {
  it('zones and rates', () => {
    expect(zoneFor('560001', '560034')).toBe('LOCAL');
    expect(zoneFor('560001', '562001')).toBe('REGIONAL');
    expect(zoneFor('560001', '400001')).toBe('METRO');
    expect(zoneFor('560001', '302001')).toBe('NATIONAL');
    expect(zoneFor('560001', '744101')).toBe('REMOTE');
    expect(serviceable('904001')).toBe(false);
    expect(rateFor('LOCAL', 500, false)).toBe(3_500);
    expect(rateFor('LOCAL', 1_200, true)).toBe(3_500 + 2 * 1_500 + 3_000);
  });
});

describe('courier api', () => {
  let app: INestApplication;
  let courier: CourierService;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication();
    await app.init();
    courier = app.get(CourierService);
    courier.sendWebhooks = false;
    courier.autoAdvance = false;
  });
  afterAll(() => app.close());

  it('rejects a missing api key', async () => {
    await request(app.getHttpServer()).get('/v1/serviceability/matrix').expect(401);
  });

  it('books idempotently, serves a PDF label and advances tracking with signed webhooks', async () => {
    const body = {
      reference: 'ship-1',
      fromPincode: '560001',
      toPincode: '400001',
      weightGrams: 800,
      consignee: { name: 'Asha', city: 'Mumbai', state: 'Maharashtra' },
    };
    const a = await request(app.getHttpServer())
      .post('/v1/shipments')
      .set(KEY)
      .send(body)
      .expect(200);
    const b = await request(app.getHttpServer())
      .post('/v1/shipments')
      .set(KEY)
      .send(body)
      .expect(200);
    expect(b.body.awb).toBe(a.body.awb);
    expect(a.body).toMatchObject({
      zone: 'METRO',
      slaDays: 2,
      ratePaise: 7_500,
      status: 'MANIFESTED',
    });

    const pdf = await request(app.getHttpServer())
      .get(`/v1/shipments/${a.body.awb}/label`)
      .set(KEY)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    for (const s of ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const r = await request(app.getHttpServer())
        .post(`/v1/shipments/${a.body.awb}/advance`)
        .set(KEY)
        .expect(200);
      expect(r.body.status).toBe(s);
    }
    await request(app.getHttpServer())
      .post(`/v1/shipments/${a.body.awb}/advance`)
      .set(KEY)
      .expect(409);
    const hooks = courier.deliveries.filter((d) => d.awb === a.body.awb).reverse();
    expect(hooks.map((d) => JSON.parse(d.body).sequence)).toEqual([1, 2, 3]);
    expect(JSON.parse(hooks[0].body)).toMatchObject({ reference: 'ship-1', status: 'SHIPPED' });
  });

  it('refuses unserviceable pincodes', async () => {
    await request(app.getHttpServer())
      .post('/v1/shipments')
      .set(KEY)
      .send({ reference: 'ship-2', fromPincode: '560001', toPincode: '904001' })
      .expect(422);
  });
});
