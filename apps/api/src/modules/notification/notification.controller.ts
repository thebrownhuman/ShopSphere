import { Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { NotificationInternalGuard } from './notification.config';
import { NotificationService } from './notification.service';
import { preferencesPatchSchema, PreferencesStore } from './preferences';
import type { NotificationEvent } from './templates';

const TYPES = [
  'order.confirmed',
  'payment.failed',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
] as const;

const recipient = z.object({
  userId: z.string().min(1),
  name: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
});

/** Envelope check only; templates read the documented payload fields. */
const eventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(TYPES),
  payload: z.object({ orderId: z.string(), orderNumber: z.string(), recipient }).passthrough(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError('VALIDATION_FAILED', 'Invalid request', 422, r.error.issues);
  return r.data;
}

/** Worker-facing: order event feed + dispatch. */
@Controller('notifications/internal')
@UseGuards(NotificationInternalGuard)
@SkipRateLimit()
export class NotificationInternalController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('events')
  events(@Query('types') types?: string, @Query('after') after?: string) {
    const wanted = (types ?? TYPES.join(','))
      .split(',')
      .filter((t): t is (typeof TYPES)[number] => (TYPES as readonly string[]).includes(t));
    return this.notifications.feed(wanted, after || undefined);
  }

  @Post('dispatch')
  @HttpCode(200)
  dispatch(@Body() body: unknown) {
    return this.notifications.dispatch(parse(eventSchema, body) as unknown as NotificationEvent);
  }
}

/** Shopper-facing: notification preferences (Account → Notifications). */
@Controller('account/notification-preferences')
@UseGuards(AccessTokenGuard)
export class NotificationPreferencesController {
  constructor(private readonly prefs: PreferencesStore) {}

  @Get()
  get(@Auth() auth: AccessClaims) {
    return this.prefs.get(auth.sub);
  }

  @Put()
  update(@Auth() auth: AccessClaims, @Body() body: unknown) {
    return this.prefs.update(auth.sub, parse(preferencesPatchSchema, body));
  }
}
