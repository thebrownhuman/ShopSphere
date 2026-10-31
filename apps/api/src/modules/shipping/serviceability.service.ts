import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CourierRegistry } from './courier.registry';
import type { ServiceabilityMatrix } from './providers/courier-provider';

const CACHE_MS = 5 * 60_000;

/**
 * Courier serviceability + SLA (M5.6a). refresh() pulls the active courier's matrix (nightly
 * via apps/workers) and stores a snapshot; latest() serves delivery estimates from the newest
 * snapshot without calling the courier per request. Null until the first refresh: callers fall
 * back to the built-in zone table.
 */
@Injectable()
export class ServiceabilityService {
  private readonly log = new Logger(ServiceabilityService.name);
  private cache: { at: number; matrix: ServiceabilityMatrix | null } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly couriers: CourierRegistry,
  ) {}

  async refresh(): Promise<{ provider: string; version: string; fetchedAt: string }> {
    const courier = this.couriers.active;
    const matrix = await courier.serviceability();
    const row = await this.prisma.courierServiceability.create({
      data: { provider: courier.name, matrix: matrix as unknown as Prisma.InputJsonValue },
    });
    // Keep a week of history for debugging estimate changes.
    await this.prisma.courierServiceability.deleteMany({
      where: { fetchedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
    });
    this.cache = { at: Date.now(), matrix };
    this.log.log(`serviceability refreshed from ${courier.name} (${matrix.version})`);
    return {
      provider: courier.name,
      version: matrix.version,
      fetchedAt: row.fetchedAt.toISOString(),
    };
  }

  async latest(): Promise<ServiceabilityMatrix | null> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.matrix;
    const row = await this.prisma.courierServiceability.findFirst({
      orderBy: { fetchedAt: 'desc' },
    });
    const matrix = (row?.matrix as unknown as ServiceabilityMatrix | undefined) ?? null;
    this.cache = { at: Date.now(), matrix };
    return matrix;
  }

  invalidate(): void {
    this.cache = null;
  }
}
