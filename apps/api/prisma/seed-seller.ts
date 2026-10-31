import type { PrismaClient } from '@prisma/client';
import { makeGstin } from '../src/modules/seller/kyc-validation';

/**
 * Seller Central house account (M5): ShopSphere's own retail arm is a first-party seller with an
 * approved account and no user login. Idempotent.
 */
export async function seedSellers(prisma: PrismaClient): Promise<void> {
  const pickup = {
    name: 'ShopSphere Retail',
    phone: '9000000001',
    line1: 'Warehouse 4, Sector 12, Mumbai-Nashik Highway',
    line2: null,
    city: 'Bhiwandi',
    state: 'Maharashtra',
    pincode: '421302',
  };
  const seller = await prisma.seller.upsert({
    where: { slug: 'shopsphere-retail' },
    update: { isFirstParty: true },
    create: {
      slug: 'shopsphere-retail',
      name: 'ShopSphere Retail',
      isFirstParty: true,
      ratingX10: 45,
      pincode: pickup.pincode,
      city: pickup.city,
      state: pickup.state,
      cutoffHour: 16,
    },
  });
  const pan = 'AAJCS1234K';
  await prisma.sellerAccount.upsert({
    where: { sellerId: seller.id },
    update: {},
    create: {
      sellerId: seller.id,
      displayName: 'ShopSphere Retail',
      legalName: 'ShopSphere Retail Private Limited',
      status: 'APPROVED',
      isFirstParty: true,
      pan,
      gstin: makeGstin('27', pan),
      pickup,
      submittedAt: new Date(),
      reviewedAt: new Date(),
    },
  });
}
