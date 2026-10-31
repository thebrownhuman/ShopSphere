import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../shared/errors/app-error';

/** Notification env, parsed apart from the shared schema (same pattern as payment.config). */
export const notificationEnvSchema = z.object({
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('ShopSphere <no-reply@shopsphere.test>'),
  /** Links in messages point here. */
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Worker -> API calls (event feed, dispatch). */
  NOTIFICATION_INTERNAL_TOKEN: z.string().min(16).default('dev-internal-token-change-me'),
});

export type NotificationConfig = z.infer<typeof notificationEnvSchema>;
export const NOTIFICATION_CONFIG = Symbol('NOTIFICATION_CONFIG');

export function loadNotificationConfig(
  raw: Record<string, string | undefined>,
): NotificationConfig {
  const result = notificationEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid notification environment: ${issues}`);
  }
  if (raw.NODE_ENV === 'production' && raw.NOTIFICATION_INTERNAL_TOKEN === undefined) {
    throw new Error(
      'Invalid notification environment: NOTIFICATION_INTERNAL_TOKEN must be set in production',
    );
  }
  return result.data;
}

/** Guards worker-only routes with `x-internal-token`. */
@Injectable()
export class NotificationInternalGuard implements CanActivate {
  constructor(@Inject(NOTIFICATION_CONFIG) private readonly cfg: NotificationConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(
      ctx.switchToHttp().getRequest<Request>().header('x-internal-token') ?? '',
    );
    const expected = Buffer.from(this.cfg.NOTIFICATION_INTERNAL_TOKEN);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError('UNAUTHORIZED', 'Internal token required', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
