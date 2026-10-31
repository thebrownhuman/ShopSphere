import { Body, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Idempotent } from '../src/modules/shared/idempotency/idempotency.interceptor';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { RateLimit } from '../src/modules/shared/rate-limit/rate-limit.decorator';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

let counter = 0;

@Controller('test')
class TestController {
  @Post('orders')
  @Idempotent()
  create(@Body() body: { sku: string }) {
    counter += 1;
    return { orderNo: counter, sku: body.sku };
  }

  @Post('limited')
  @RateLimit({ limit: 2, windowSeconds: 60 })
  limited() {
    return { ok: true };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

describe('API (e2e, mocked infra)', () => {
  let app: INestApplication;
  const redis = new FakeRedis();
  const prisma = { $queryRaw: jest.fn().mockResolvedValue([1]), $disconnect: jest.fn() };

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, TestModule] })
      .overrideProvider(REDIS)
      .useValue(redis)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /healthz reports ok with request id', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { db: 'up', redis: 'up' } });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /healthz reports degraded when redis is down', async () => {
    redis.down = true;
    const res = await request(app.getHttpServer()).get('/healthz').expect(200);
    redis.down = false;
    expect(res.body).toMatchObject({ status: 'degraded', checks: { redis: 'down' } });
  });

  it('echoes a valid inbound request id', async () => {
    const res = await request(app.getHttpServer()).get('/healthz').set('x-request-id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('unknown route uses the global error format', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: expect.any(String) });
  });

  it('idempotent route requires the header', async () => {
    const res = await request(app.getHttpServer())
      .post('/test/orders')
      .send({ sku: 'a' })
      .expect(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('idempotent route replays the first response', async () => {
    const server = app.getHttpServer();
    const first = await request(server)
      .post('/test/orders')
      .set('Idempotency-Key', 'k1')
      .send({ sku: 'a' });
    const second = await request(server)
      .post('/test/orders')
      .set('Idempotency-Key', 'k1')
      .send({ sku: 'a' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(counter).toBe(1);
  });

  it('idempotent route rejects key reuse with a different body', async () => {
    const res = await request(app.getHttpServer())
      .post('/test/orders')
      .set('Idempotency-Key', 'k1')
      .send({ sku: 'b' })
      .expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('rate limiter returns 429 past the limit', async () => {
    const server = app.getHttpServer();
    await request(server).post('/test/limited').expect(201);
    await request(server).post('/test/limited').expect(201);
    const res = await request(server).post('/test/limited').expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });

  it('rate limiter fails open when redis is down', async () => {
    redis.down = true;
    await request(app.getHttpServer()).post('/test/limited').expect(201);
    redis.down = false;
  });
});

describe('Payment webhooks (e2e, mocked infra)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(new FakeRedis())
      .overrideProvider(PrismaService)
      .useValue({ $disconnect: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(() => app.close());

  it('rejects a webhook with a bad signature before touching the database', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/webhooks/bank')
      .set('content-type', 'application/json')
      .set('x-bank-signature', 'deadbeef')
      .send(JSON.stringify({ event: 'payment.captured' }))
      .expect(401);
    expect(res.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('rejects an unknown provider', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/webhooks/paypal')
      .send({})
      .expect(400);
    expect(res.body.code).toBe('PROVIDER_UNAVAILABLE');
  });
});
