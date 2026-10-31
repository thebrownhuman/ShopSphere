import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { seedCatalog } from './seed-catalog';
import { seedAdmin } from './seed-admin';
import { seedSellers } from './seed-seller';

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
  ['122001', 'Gurugram', 'Haryana', true],
  ['421302', 'Bhiwandi', 'Maharashtra', true],
  ['781001', 'Guwahati', 'Assam', true],
  ['682001', 'Kochi', 'Kerala', true],
  ['160017', 'Chandigarh', 'Chandigarh', true],
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
    const reset = process.env.SEED_RESET === '1';
    const seeded = await seedCatalog(prisma, {
      products: Number(process.env.SEED_PRODUCTS ?? 5000),
      reset,
    });
    await seedSellers(prisma);
    await seedAdmin(prisma);
    if (seeded || process.env.SEED_REINDEX === '1') await reindexSearch();
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

/** Builds the OpenSearch index through the API's own indexer so documents match production. */
async function reindexSearch() {
  const started = Date.now();
  try {
    const { NestFactory } = await import('@nestjs/core');
    const { SearchModule } = await import('../src/modules/search/search.module');
    const { SharedModule } = await import('../src/modules/shared/shared.module');
    const { Module } = await import('@nestjs/common');
    const { SearchIndexerService } = await import('../src/modules/search/search-indexer.service');
    @Module({ imports: [SharedModule, SearchModule] })
    class SeedIndexModule {}
    const app = await NestFactory.createApplicationContext(SeedIndexModule, { logger: ['error'] });
    try {
      const { indexed } = await app.get(SearchIndexerService).reindexAll();
      console.log(
        `search: indexed ${indexed} products in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } finally {
      await app.close();
    }
  } catch (err) {
    console.warn(
      `search: indexing skipped (${(err as Error).message}). Is OpenSearch up? Re-run with SEED_REINDEX=1.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
