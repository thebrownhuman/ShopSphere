import { PrismaClient } from '@prisma/client';

/** Seed stub. Catalog/category/user fixtures land with their milestones. */
async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.auditLog.create({
      data: {
        actorType: 'system',
        action: 'seed.run',
        entityType: 'system',
        entityId: 'seed',
      },
    });
    console.log('seed complete');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
