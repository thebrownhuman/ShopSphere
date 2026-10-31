import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { AppConfig } from '../config/config.service';
import { AppError } from '../errors/app-error';
import { REDIS } from '../redis/redis.module';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';

/**
 * Fixed-window Redis rate limiter keyed by client IP + route.
 * Fails open if Redis is unavailable: availability beats limiting for a read path.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const override = this.reflector.getAllAndOverride<RateLimitOptions | null | undefined>(
      RATE_LIMIT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (override === null) return true;
    const { limit, windowSeconds } = override ?? {
      limit: this.config.get('RATE_LIMIT_PER_MINUTE'),
      windowSeconds: 60,
    };

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const route = `${req.method}:${req.route?.path ?? req.path}`;
    const key = `rl:${req.ip}:${route}:${window}`;

    let count: number;
    try {
      const results = await this.redis.multi().incr(key).expire(key, windowSeconds).exec();
      count = Number(results?.[0]?.[1] ?? 0);
    } catch (err) {
      this.logger.warn({ err }, 'rate limiter unavailable, failing open');
      return true;
    }

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));
    if (count > limit) {
      throw new AppError('RATE_LIMITED', 'Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
