import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { from, Observable, of, switchMap, tap } from 'rxjs';
import { AppError } from '../errors/app-error';
import { REDIS } from '../redis/redis.module';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const IDEMPOTENT_KEY = 'idempotent';
const LOCK_TTL_SECONDS = 60;
const RESULT_TTL_SECONDS = 24 * 60 * 60;

/** Mark a mutating route as requiring an Idempotency-Key header (place order, initiate payment, ...). */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

interface StoredResult {
  state: 'done';
  fingerprint: string;
  status: number;
  body: unknown;
}
interface InFlight {
  state: 'in_flight';
  fingerprint: string;
}

/**
 * Replays the first successful response for a repeated (route, key) pair.
 * - Same key + different body -> 422 IDEMPOTENCY_KEY_REUSED.
 * - Same key while first call still running -> 409 IDEMPOTENCY_IN_PROGRESS.
 * - Failed calls release the key so the client can retry.
 * Domain tables still enforce uniqueness (e.g. orders.idempotency_key UNIQUE); this is the HTTP layer.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return next.handle();

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header(IDEMPOTENCY_HEADER);
    if (!key || key.length > 255) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }
    const redisKey = `idem:${req.method}:${req.route?.path ?? req.path}:${key}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');

    return from(this.claim(redisKey, fingerprint)).pipe(
      switchMap((existing) => {
        if (existing) {
          res.status(existing.status);
          return of(existing.body);
        }
        return next.handle().pipe(
          tap({
            next: (body) => {
              const stored: StoredResult = {
                state: 'done',
                fingerprint,
                status: res.statusCode,
                body,
              };
              void this.redis.set(redisKey, JSON.stringify(stored), 'EX', RESULT_TTL_SECONDS);
            },
            error: () => void this.redis.del(redisKey),
          }),
        );
      }),
    );
  }

  /** Returns a stored result to replay, null if this request now owns the key, or throws. */
  private async claim(redisKey: string, fingerprint: string): Promise<StoredResult | null> {
    const lock: InFlight = { state: 'in_flight', fingerprint };
    const acquired = await this.redis.set(
      redisKey,
      JSON.stringify(lock),
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (acquired) return null;

    const raw = await this.redis.get(redisKey);
    if (!raw) return this.claim(redisKey, fingerprint);
    const current = JSON.parse(raw) as StoredResult | InFlight;
    if (current.fingerprint !== fingerprint) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key was already used with a different request body',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (current.state === 'in_flight') {
      throw new AppError(
        'IDEMPOTENCY_IN_PROGRESS',
        'A request with this key is in progress',
        HttpStatus.CONFLICT,
      );
    }
    return current;
  }
}
