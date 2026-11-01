/**
 * DPDP export + account deletion (M7.3) against a real Postgres. Archives go to an in-memory
 * store and mail to a recording channel. Run with
 * `corepack pnpm --filter @shopsphere/api exec jest test/privacy.int.spec.ts --testPathIgnorePatterns /node_modules/`
 * (DATABASE_URL migrated with `prisma migrate deploy`).
 */
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { NOTIFICATION_CHANNELS } from '../src/modules/notification/channels';
import { PrivacyExportStore } from '../src/modules/privacy/export.store';
import { DELETED_NAME, PrivacyService } from '../src/modules/privacy/privacy.service';
import { unzip } from '../src/modules/privacy/zip';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';
import { REDIS } from '../src/modules/shared/redis/redis.module';
import { FakeRedis } from './fake-redis';

const run = Date.now().toString(36);
process.env.DATABASE_URL ??=
  'postgresql://shopsphere:shopsphere@localhost:5440/m7_privacy?schema=public';
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.ORDER_WORKERS_ENABLED = 'false';
process.env.PRIVACY_WORKERS_ENABLED = 'false';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.PRIVACY_DELETION_GRACE_DAYS = '14';
process.env.CATALOG_INTERNAL_TOKEN = 'it-internal-token-0123456789';

class HashRedis extends FakeRedis {
  hashes = new Map<string, Record<string, string>>();
  async hgetall(key: string) {
    return this.hashes.get(key) ?? {};
  }
  async hset(key: string, fields: Record<string, string>) {
    this.hashes.set(key, { ...(this.hashes.get(key) ?? {}), ...fields });
    return 1;
  }
  async del(key: string) {
    this.hashes.delete(key);
    return super.del(key);
  }
}

class MemoryExportStore extends PrivacyExportStore {
  readonly objects = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) {
    this.objects.set(key, bytes);
  }
  async signedUrl(key: string) {
    return `http://s3.test/${key}?X-Amz-Signature=sig`;
  }
  async remove(key: string) {
    this.objects.delete(key);
  }
}

const mails: Array<{ to: string; subject: string }> = [];
const channels = {
  email: async (to: string, subject: string) => void mails.push({ to, subject }),
  sms: async () => undefined,
  whatsapp: async () => undefined,
};

describe('privacy: DPDP export + deletion (integration, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let privacy: PrivacyService;
  let baseUrl: string;
  const store = new MemoryExportStore();
  const redis = new HashRedis();
  const http = () => request(baseUrl);

  async function shopper(tag: string) {
    const email = `privacy-${tag}-${run}@example.test`;
    const user = await prisma.user.create({
      data: {
        name: `Asha ${tag}`,
        passwordHash: 'argon2-hash',
        identities: { create: { type: 'email', value: email, verifiedAt: new Date() } },
        addresses: {
          create: {
            name: `Asha ${tag}`,
            phone: '+919876543210',
            line1: '12 MG Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
        },
      },
    });
    const sessions = app.get(SessionService);
    const main = await sessions.create(user.id, false, {});
    const other = await sessions.create(user.id, true, {});
    return { id: user.id, email, auth: `Bearer ${main.accessToken}`, main, other };
  }

  async function order(userId: string, status: string) {
    return prisma.order.create({
      data: {
        number: `OD${run}${Math.random().toString(36).slice(2, 8)}`,
        userId,
        checkoutId: randomUUID(),
        idempotencyKey: randomUUID(),
        status,
        paymentMethod: 'COD',
        itemsPaise: 100_000n,
        mrpPaise: 120_000n,
        deliveryPaise: 0n,
        couponDiscountPaise: 0n,
        codFeePaise: 0n,
        totalPaise: 100_000n,
        storeBalancePaise: 0n,
        payablePaise: 100_000n,
        cgstPaise: 7_627n,
        sgstPaise: 7_627n,
        igstPaise: 0n,
        address: {
          name: 'Asha',
          phone: '+919876543210',
          line1: '12 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
        shipToState: 'Karnataka',
        source: 'CART',
      },
    });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS)
      .useValue(redis)
      .overrideProvider(PrivacyExportStore)
      .useValue(store)
      .overrideProvider(NOTIFICATION_CHANNELS)
      .useValue(channels)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    prisma = app.get(PrismaService);
    privacy = app.get(PrivacyService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exports the shopper data as a zip of JSON files and emails a link', async () => {
    const u = await shopper('export');
    const o = await order(u.id, 'DELIVERED');
    await redis.hset(`notif:prefs:${u.id}`, { 'offers.email': '0' });

    const res = await http().post('/me/export').set('Authorization', u.auth).expect(202);
    expect(res.body.status).toBe('PENDING');
    // The job starts in-process right away; running it again is a no-op (row is claimed).
    await privacy.runExport(res.body.id);
    for (let i = 0; i < 50; i++) {
      const r = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: res.body.id } });
      if (r.status === 'READY') break;
      await new Promise((ok) => setTimeout(ok, 50));
    }

    const got = await http().get('/me/export').set('Authorization', u.auth).expect(200);
    expect(got.body).toMatchObject({ id: res.body.id, status: 'READY' });
    expect(got.body.downloadUrl).toContain(`privacy-exports/${u.id}/${res.body.id}.zip`);
    expect(mails).toContainEqual(expect.objectContaining({ to: u.email }));

    const files = unzip(store.objects.get(`privacy-exports/${u.id}/${res.body.id}.zip`)!);
    expect([...files.keys()]).toEqual(
      expect.arrayContaining(['README.txt', 'profile.json', 'addresses.json', 'orders.json']),
    );
    const profile = JSON.parse(files.get('profile.json')!.toString());
    expect(profile.name).toBe('Asha export');
    expect(profile.identities[0].value).toBe(u.email);
    expect(profile.notificationPreferences).toEqual({ 'offers.email': '0' });
    expect(JSON.stringify(profile)).not.toContain('argon2-hash');
    const orders = JSON.parse(files.get('orders.json')!.toString());
    expect(orders[0]).toMatchObject({ id: o.id, totalPaise: '100000' });
    const addresses = JSON.parse(files.get('addresses.json')!.toString());
    expect(addresses[0].line1).toBe('12 MG Road');
    const sessions = JSON.parse(files.get('sessions.json')!.toString());
    expect(sessions.sessions).toHaveLength(2);

    // Another one the same day is refused; the ready one stays downloadable.
    await http().post('/me/export').set('Authorization', u.auth).expect(429);
  });

  it('requires a recent re-auth and no open orders to schedule deletion', async () => {
    const u = await shopper('guard');
    await prisma.session.update({ where: { id: u.main.sessionId }, data: { reauthAt: null } });
    const r1 = await http().post('/me/delete-account').set('Authorization', u.auth).expect(403);
    expect(r1.body.code).toBe('REAUTH_REQUIRED');
    await prisma.session.update({
      where: { id: u.main.sessionId },
      data: { reauthAt: new Date() },
    });
    await order(u.id, 'SHIPPED');
    const r2 = await http().post('/me/delete-account').set('Authorization', u.auth).expect(409);
    expect(r2.body.code).toBe('OPEN_ORDERS');
  });

  it('schedules deletion, can be cancelled, and anonymises after the grace period', async () => {
    const u = await shopper('delete');
    const o = await order(u.id, 'DELIVERED');
    const productId = randomUUID();
    await prisma.review.create({
      data: {
        productId,
        userId: u.id,
        orderId: o.id,
        rating: 5,
        title: 'Great',
        body: 'Works well',
        authorName: 'Asha delete',
      },
    });
    await prisma.supportTicket.create({
      data: {
        number: `T${run}`,
        userId: u.id,
        category: 'OTHER',
        subject: 'Hi',
        message: 'my phone is 9876543210',
      },
    });
    await prisma.recentlyViewed.create({ data: { ownerKey: `u:${u.id}`, productId } });

    // Cancel path.
    await http().post('/me/delete-account').set('Authorization', u.auth).expect(202);
    await http().delete('/me/delete-account').set('Authorization', u.auth).expect(204);
    const overview = await http().get('/me/privacy').set('Authorization', u.auth).expect(200);
    expect(overview.body.deletion).toBeNull();

    const res = await http().post('/me/delete-account').set('Authorization', u.auth).expect(202);
    const due = new Date(res.body.scheduledFor);
    expect(due.getTime() - Date.now()).toBeGreaterThan(13.9 * 24 * 3600 * 1000);
    // Other devices are signed out at once; this one stays so the shopper can cancel.
    const other = await prisma.session.findUniqueOrThrow({ where: { id: u.other.sessionId } });
    expect(other.revokedReason).toBe('account_deletion_requested');
    await http().get('/me/privacy').set('Authorization', u.auth).expect(200);

    expect((await privacy.sweep(new Date())).deleted).toBe(0);
    await http().post('/privacy/internal/sweep').expect(401);
    const swept = await privacy.sweep(new Date(due.getTime() + 1000));
    expect(swept.deleted).toBeGreaterThanOrEqual(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(user).toMatchObject({ name: null, passwordHash: null, status: 'deleted' });
    expect(user.deletedAt).not.toBeNull();
    expect(await prisma.userIdentity.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.address.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.recentlyViewed.count({ where: { ownerKey: `u:${u.id}` } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    // The access token stops working immediately.
    await http().get('/me/privacy').set('Authorization', u.auth).expect(401);

    // Orders kept for tax, address reduced to city/state/pincode.
    const kept = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(kept.totalPaise).toBe(100_000n);
    expect(kept.address).toMatchObject({
      name: DELETED_NAME,
      phone: null,
      line1: null,
      state: 'Karnataka',
      pincode: '560001',
    });
    const review = await prisma.review.findFirstOrThrow({ where: { userId: u.id } });
    expect(review.authorName).toBe('ShopSphere customer');
    const ticket = await prisma.supportTicket.findFirstOrThrow({ where: { userId: u.id } });
    expect(ticket.message).not.toContain('9876543210');
    const req = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(req.status).toBe('COMPLETED');
  });
});
