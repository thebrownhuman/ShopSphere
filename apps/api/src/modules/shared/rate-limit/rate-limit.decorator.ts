import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Max requests per window per client. */
  limit: number;
  /** Env key whose value replaces `limit` (operators tune it without a deploy of code). */
  limitFrom?: 'PLACE_ORDER_RATE_LIMIT_PER_MINUTE';
  windowSeconds: number;
}

/** Override the global default on a route/controller, e.g. tighter limits for OTP endpoints. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
export const SkipRateLimit = () => SetMetadata(RATE_LIMIT_KEY, null);
