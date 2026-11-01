import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  OUTBOX_PUBLISHER_ENABLED: bool,
  /** Reverse-proxy hops in front of the API (0 = direct). Sets Express `trust proxy`. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Bot protection on POST /checkout/:id/place-order (per client IP per minute). */
  PLACE_ORDER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  // Fraud scoring v1 (M7.2). Scores are 0–100.
  FRAUD_FORCE_PREPAID_SCORE: z.coerce.number().int().min(1).max(100).default(50),
  FRAUD_REVIEW_SCORE: z.coerce.number().int().min(1).max(100).default(80),
  FRAUD_CAPTCHA_SCORE: z.coerce.number().int().min(1).max(100).default(60),
  FRAUD_HIGH_VALUE_PAISE: z.coerce.number().int().positive().default(1_000_000),
  FRAUD_NEW_ACCOUNT_DAYS: z.coerce.number().int().min(0).default(7),
  FRAUD_USER_ORDERS_PER_HOUR: z.coerce.number().int().positive().default(3),
  FRAUD_DEVICE_ORDERS_PER_HOUR: z.coerce.number().int().positive().default(5),
  FRAUD_DEVICE_USERS_PER_DAY: z.coerce.number().int().positive().default(3),
  FRAUD_IP_ORDERS_PER_HOUR: z.coerce.number().int().positive().default(15),
});

export type Env = z.infer<typeof envSchema>;

/** Parse and validate env; throws with every invalid key listed so boot fails fast. */
export function validateEnv(raw: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}
