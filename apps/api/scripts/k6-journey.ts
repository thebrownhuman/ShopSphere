/**
 * Fixture for infra/k6/journey.js (M7.5 full-journey load test).
 *   setup [users=300]
 *     - `users` shoppers with an address and an access token,
 *     - 40 in-stock products (default SKU, their offer topped up to 1,000,000 units) + search terms.
 *   Writes infra/k6/journey-fixture.json. Uses the API's DATABASE_URL / REDIS_URL / JWT_SECRET.
 */
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';

const FIXTURE = join(__dirname, '../../../infra/k6/journey-fixture.json');

async function setup(users: number) {
  process.env.ORDER_WORKERS_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const sessions = app.get(SessionService);

  const offers = await prisma.offer.findMany({
    where: { stockQty: { gt: 0 }, sku: { isDefault: true, product: { status: 'ACTIVE' } } },
    include: { sku: { include: { product: { select: { slug: true, title: true } } } } },
    orderBy: { price: 'asc' },
    take: 40,
  });
  await prisma.offer.updateMany({
    where: { id: { in: offers.map((o) => o.id) } },
    data: { stockQty: 1_000_000, maxPerOrder: 10 },
  });
  const products = offers.map((o) => ({
    slug: o.sku.product.slug,
    skuId: o.skuId,
    sellerId: o.sellerId,
    term: o.sku.product.title.split(/\s+/).slice(0, 2).join(' '),
  }));

  const out = { run: `jr${Date.now().toString(36)}`, products, users: [] as unknown[] };
  for (let i = 0; i < users; i++) {
    const user = await prisma.user.create({ data: { name: `k6 journey ${i}` } });
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        name: `Journey ${i}`,
        phone: '+919876543210',
        line1: `${i} Load Test Road`,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
        isDefault: true,
      },
    });
    const tokens = await sessions.create(user.id, false, {});
    out.users.push({ userId: user.id, token: tokens.accessToken, addressId: address.id });
  }

  writeFileSync(FIXTURE, JSON.stringify(out));
  await app.close();
  console.log(`fixture: ${users} users, ${products.length} products -> ${FIXTURE}`);
}

const [cmd, a] = process.argv.slice(2);
if (cmd !== 'setup') {
  console.error('usage: k6-journey.ts setup [users]');
  process.exit(1);
}
setup(Number(a ?? 300)).catch((err) => {
  console.error(err);
  process.exit(1);
});
