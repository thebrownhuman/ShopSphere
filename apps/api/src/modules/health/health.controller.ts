import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@shopsphere/types';
import type Redis from 'ioredis';
import { PrismaService } from '../shared/prisma/prisma.service';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { REDIS } from '../shared/redis/redis.module';

const CHECK_TIMEOUT_MS = 1000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
  ]);
}

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness + dependency status. Always 200 while the process is up; `status` reports degradation. */
  @Get('healthz')
  @SkipRateLimit()
  async healthz(): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
      withTimeout(this.redis.ping()).then(
        () => 'up' as const,
        () => 'down' as const,
      ),
    ]);
    return {
      status: db === 'up' && redis === 'up' ? 'ok' : 'degraded',
      time: new Date().toISOString(),
      checks: { db, redis },
    };
  }
}
