/**
 * Fixture + verification for infra/k6/checkout-oversell.js (M4.33).
 *   setup  [users=500] [stock=10]  creates a product with `stock` units and `users` shoppers with
 *                                   access tokens and an address; writes infra/k6/oversell-fixture.json
 *   verify                          asserts exactly `stock` orders, stock 0 and nothing reserved
 * Uses the same DATABASE_URL / REDIS_URL / JWT_SECRET env as the API under test.
 */
import { NestFactory } from '@nestjs/core';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { SessionService } from '../src/modules/identity/tokens/session.service';
import { PrismaService } from '../src/modules/shared/prisma/prisma.service';

const FIXTURE = join(__dirname, '../../../infra/k6/oversell-fixture.json');

interface Fixture {
  run: string;
  skuId: string;
  offerId: string;
  stock: number;
  users: { userId: string; token: string; addressId: string }[];
}

async function setup(users: number, stock: number) {
  process.env.ORDER_WORKERS_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const sessions = app.get(SessionService);
  const run = `k6${Date.now().toString(36)}`;
  const cat = await prisma.category.create({
    data: { slug: run, name: 'k6', path: run, gstRateBp: 1800 },
  });
  const brand = await prisma.brand.create({ data: { slug: run, name: 'k6' } });
  const seller = await prisma.seller.create({
    data: {
      name: 'k6 Seller',
      slug: run,
      pincode: '560001',
      city: 'Bengaluru',
      state: 'Karnataka',
    },
  });
  const product = await prisma.product.create({
    data: {
      slug: run,
      title: 'k6 flash-sale item',
      brandId: brand.id,
      categoryId: cat.id,
      skus: { create: { code: run.toUpperCase(), isDefault: true } },
    },
    include: { skus: true },
  });
  const offer = await prisma.offer.create({
    data: {
      skuId: product.skus[0].id,
      sellerId: seller.id,
      price: 49_900n,
      mrp: 99_900n,
      stockQty: stock,
      maxPerOrder: 1,
    },
  });
  const out: Fixture = { run, skuId: product.skus[0].id, offerId: offer.id, stock, users: [] };
  for (let i = 0; i < users; i++) {
    const user = await prisma.user.create({ data: { name: `k6 shopper ${i}` } });
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        name: `Shopper ${i}`,
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
  console.log(`fixture: ${users} users, ${stock} units of sku ${out.skuId} -> ${FIXTURE}`);
}

async function verify() {
  const f = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
  const prisma = new PrismaService();
  const offer = await prisma.offer.findUniqueOrThrow({ where: { id: f.offerId } });
  const orders = await prisma.orderItem.count({ where: { skuId: f.skuId } });
  const confirmed = await prisma.order.count({
    where: { status: 'CONFIRMED', items: { some: { skuId: f.skuId } } },
  });
  await prisma.$disconnect();
  const result = {
    orders,
    confirmed,
    stockQty: offer.stockQty,
    reservedQty: offer.reservedQty,
    expected: f.stock,
  };
  console.log(JSON.stringify(result));
  const ok =
    orders === f.stock && confirmed === f.stock && offer.stockQty === 0 && offer.reservedQty === 0;
  if (!ok) {
    console.error('OVERSELL CHECK FAILED');
    process.exit(1);
  }
  console.log('PASS: exactly %d orders, stock 0, nothing reserved', f.stock);
}

const [cmd, a, b] = process.argv.slice(2);
(cmd === 'verify' ? verify() : setup(Number(a ?? 500), Number(b ?? 10))).catch((err) => {
  console.error(err);
  process.exit(1);
});
