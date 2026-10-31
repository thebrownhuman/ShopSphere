/**
 * Returns E2E helper: makes `userId` the Seller Central user of the seller that ships
 * `orderId`, so the test can drive the seller API. Usage: node link-seller.cjs <orderId> <userId>
 */
const path = require('node:path');
const { PrismaClient } = require(
  require.resolve('@prisma/client', { paths: [path.resolve(__dirname, '../../../api')] }),
);

async function main() {
  const [orderId, userId] = process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    const { sellerId } = await prisma.shipment.findFirstOrThrow({ where: { orderId } });
    await prisma.sellerAccount.upsert({
      where: { sellerId },
      update: { userId, status: 'APPROVED' },
      create: { sellerId, userId, displayName: 'E2E seller', status: 'APPROVED' },
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
