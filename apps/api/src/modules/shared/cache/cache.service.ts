import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { MetricsService } from '../metrics/metrics.service';
import { REDIS } from '../redis/redis.module';

/**
 * Redis read-through cache for hot public reads (M7.5): home sections, home product rows, PDP.
 * Values must be JSON-safe. Short TTLs instead of invalidation: every cached read is already
 * allowed to be that stale by its HTTP Cache-Control. Redis errors fall through to the loader.
 * CACHE_DISABLED=true turns it off (used for the "before" load-test run).
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly disabled = process.env.CACHE_DISABLED === 'true';
  /** Concurrent misses for the same key share one load (no stampede on expiry). */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  async getOrSet<T>(
    name: string,
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
  ): Promise<T> {
    if (this.disabled) return load();
    const full = `cache:${name}:${key}`;
    try {
      const hit = await this.redis.get(full);
      if (hit !== null) {
        this.metrics.cache.inc({ name, result: 'hit' });
        return JSON.parse(hit) as T;
      }
    } catch (err) {
      this.logger.warn({ err: String(err), name }, 'cache read failed');
    }
    this.metrics.cache.inc({ name, result: 'miss' });
    const pending = this.inflight.get(full) as Promise<T> | undefined;
    if (pending) return pending;
    const p = load()
      .then(async (value) => {
        try {
          await this.redis.set(full, JSON.stringify(value), 'EX', ttlSeconds);
        } catch (err) {
          this.logger.warn({ err: String(err), name }, 'cache write failed');
        }
        return value;
      })
      .finally(() => this.inflight.delete(full));
    this.inflight.set(full, p);
    return p;
  }
}
