import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../shared/redis/redis.module';
import { IDENTITY_LIMITS } from '../identity.config';

/**
 * Failed-login counters per account and per IP over a 15-minute window.
 * After 5 failures on either, a CAPTCHA is required (PRD §3 security rules).
 */
@Injectable()
export class LoginThrottleService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async captchaRequired(account: string, ip: string): Promise<boolean> {
    const [a, i] = await Promise.all([
      this.redis.get(this.accountKey(account)),
      this.redis.get(this.ipKey(ip)),
    ]);
    const limit = IDENTITY_LIMITS.loginFailuresBeforeCaptcha;
    return Number(a ?? 0) >= limit || Number(i ?? 0) >= limit;
  }

  /** Returns the account's failure count including this one. */
  async recordFailure(account: string, ip: string): Promise<number> {
    const window = IDENTITY_LIMITS.loginFailureWindowSeconds;
    const res = await this.redis
      .multi()
      .incr(this.accountKey(account))
      .expire(this.accountKey(account), window)
      .incr(this.ipKey(ip))
      .expire(this.ipKey(ip), window)
      .exec();
    return Number(res?.[0]?.[1] ?? 0);
  }

  async reset(account: string): Promise<void> {
    await this.redis.del(this.accountKey(account));
  }

  private accountKey(account: string) {
    return `loginfail:acct:${account}`;
  }

  private ipKey(ip: string) {
    return `loginfail:ip:${ip}`;
  }
}
