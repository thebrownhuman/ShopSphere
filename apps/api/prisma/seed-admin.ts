import { hash } from '@node-rs/argon2';
import type { PrismaClient } from '@prisma/client';

/**
 * Admin console fixtures (M6.5–M6.7), idempotent:
 * - one SUPER_ADMIN staff user. Credentials come from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD
 *   (see .env.example); the fallbacks below are local-simulation values, never for real use.
 * - a "Lightning Deals" home row fed by admin-created deals.
 * - the "10% off with ShopSphere Bank cards" bank offer.
 */
export const ADMIN_SEED_EMAIL = process.env.ADMIN_SEED_EMAIL ?? 'admin@shopsphere.test';
export const ADMIN_SEED_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? 'Admin@ShopSphere1';

export async function seedAdmin(prisma: PrismaClient): Promise<void> {
  const email = ADMIN_SEED_EMAIL.toLowerCase();
  const identity = await prisma.userIdentity.findUnique({
    where: { type_value: { type: 'email', value: email } },
  });
  const passwordHash = await hash(ADMIN_SEED_PASSWORD, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const userId =
    identity?.userId ??
    (
      await prisma.user.create({
        data: {
          name: 'ShopSphere Admin',
          passwordHash,
          identities: { create: { type: 'email', value: email, verifiedAt: new Date() } },
        },
      })
    ).id;
  await prisma.staffRole.upsert({
    where: { userId_role: { userId, role: 'SUPER_ADMIN' } },
    update: {},
    create: { userId, role: 'SUPER_ADMIN' },
  });

  const dealRow = await prisma.homeSection.findFirst({
    where: { type: 'DEAL_ROW', title: 'Lightning Deals' },
  });
  if (!dealRow) {
    await prisma.homeSection.create({
      data: {
        type: 'DEAL_ROW',
        title: 'Lightning Deals',
        dataSource: { lightningDeals: true, limit: 12 },
        position: 15,
      },
    });
  }

  const offerTitle = '10% off with ShopSphere Bank cards';
  if (!(await prisma.bankOffer.findFirst({ where: { title: offerTitle } }))) {
    await prisma.bankOffer.create({
      data: {
        title: offerTitle,
        provider: 'bank',
        percentBp: 1000,
        maxDiscountPaise: 150_000n,
        minOrderPaise: 0n,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2030-01-01T00:00:00Z'),
      },
    });
  }
}
