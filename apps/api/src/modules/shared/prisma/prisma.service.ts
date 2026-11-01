import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Transaction client type, passed to helpers that must join the caller's transaction. */
export type Tx = Prisma.TransactionClient;

/**
 * DATABASE_POOL_SIZE / DATABASE_POOL_TIMEOUT_S set Prisma's `connection_limit` / `pool_timeout`
 * unless DATABASE_URL already carries them (M7.5). Prisma's default (2 × CPUs + 1) starves the
 * checkout transactions under load; see docs/perf/load-test.md for the chosen numbers.
 */
export function pooledUrl(raw: string | undefined, env = process.env): string | undefined {
  if (!raw) return raw;
  const url = new URL(raw);
  if (env.DATABASE_POOL_SIZE && !url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', env.DATABASE_POOL_SIZE);
  }
  if (env.DATABASE_POOL_TIMEOUT_S && !url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', env.DATABASE_POOL_TIMEOUT_S);
  }
  return url.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const url = pooledUrl(process.env.DATABASE_URL);
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
