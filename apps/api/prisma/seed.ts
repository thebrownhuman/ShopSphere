import { PrismaClient } from '@prisma/client';

/** Sample pincode directory (M1.8). A full India Post dataset can be imported later. */
const PINCODES: [string, string, string, boolean][] = [
  ['110001', 'New Delhi', 'Delhi', true],
  ['400001', 'Mumbai', 'Maharashtra', true],
  ['560001', 'Bengaluru', 'Karnataka', true],
  ['600001', 'Chennai', 'Tamil Nadu', true],
  ['700001', 'Kolkata', 'West Bengal', true],
  ['500001', 'Hyderabad', 'Telangana', true],
  ['411001', 'Pune', 'Maharashtra', true],
  ['380001', 'Ahmedabad', 'Gujarat', true],
  ['302001', 'Jaipur', 'Rajasthan', true],
  ['226001', 'Lucknow', 'Uttar Pradesh', true],
  ['744101', 'Port Blair', 'Andaman and Nicobar Islands', false],
  ['194101', 'Leh', 'Ladakh', false],
];

/** Seed: idempotent, safe to re-run. Catalog fixtures land with their milestones. */
async function main() {
  const prisma = new PrismaClient();
  try {
    for (const [pincode, city, state, serviceable] of PINCODES) {
      await prisma.pincode.upsert({
        where: { pincode },
        update: { city, state, serviceable },
        create: { pincode, city, state, serviceable },
      });
    }
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
