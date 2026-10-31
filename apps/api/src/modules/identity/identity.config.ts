import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    JWT_SECRET: z.string().min(32).default('dev-only-jwt-secret-change-me-0123456789'),
    /** Shared with apps/web so SSR can verify the signed session cookie. */
    SESSION_COOKIE_SECRET: z.string().min(32).default('dev-only-session-cookie-secret-0123456789'),
    WEB_URL: z.string().url().default('http://localhost:3000'),
    API_URL: z.string().url().default('http://localhost:4000'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    MAIL_FROM: z.string().default('ShopSphere <no-reply@shopsphere.test>'),
    /** Empty = Google sign-in disabled (routes return GOOGLE_DISABLED). */
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    TURNSTILE_SECRET_KEY: z.string().default(TURNSTILE_TEST_SECRET),
  })
  .refine((e) => e.NODE_ENV !== 'production' || !e.JWT_SECRET.startsWith('dev-only'), {
    message: 'JWT_SECRET must be set in production',
    path: ['JWT_SECRET'],
  });

export type IdentityEnv = z.infer<typeof schema>;

/** Identity-only settings, validated separately from the platform env so modules stay independent. */
@Injectable()
export class IdentityConfig {
  readonly env: IdentityEnv;

  constructor() {
    this.env = IdentityConfig.parse(process.env);
  }

  static parse(raw: Record<string, string | undefined>): IdentityEnv {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      throw new Error(`Invalid identity environment: ${issues.join('; ')}`);
    }
    return result.data;
  }

  get googleEnabled(): boolean {
    return this.env.GOOGLE_CLIENT_ID !== '' && this.env.GOOGLE_CLIENT_SECRET !== '';
  }
}

export const IDENTITY_LIMITS = {
  accessTokenSeconds: 15 * 60,
  persistentSessionSeconds: 30 * 24 * 60 * 60,
  /** "Keep me signed in" off: cookie dies with the browser, server caps the session at 12 h. */
  browserSessionSeconds: 12 * 60 * 60,
  otpTtlSeconds: 5 * 60,
  otpMaxAttempts: 5,
  otpResendCooldownSeconds: 30,
  loginFailureWindowSeconds: 15 * 60,
  loginFailuresBeforeCaptcha: 5,
  reauthValiditySeconds: 10 * 60,
  pendingTokenSeconds: 10 * 60,
} as const;
