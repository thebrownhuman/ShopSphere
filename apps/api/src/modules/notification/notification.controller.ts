import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PushPublicKey } from '@shopsphere/types';
import { z } from 'zod';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { NotificationInternalGuard } from './notification.config';
import { NotificationService } from './notification.service';
import { preferencesPatchSchema, PreferencesStore } from './preferences';
import { NOTIFIED_TYPES, type NotificationEvent } from './templates';
import { WebPushService } from './web-push.service';

const TYPES = NOTIFIED_TYPES;

/** Envelope check only; templates read OrderEventPayloads fields. */
const eventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(TYPES),
  payload: z
    .object({
      orderId: z.string(),
      orderNumber: z.string(),
      userId: z.string(),
      status: z.string(),
    })
    .passthrough(),
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

const pushSubSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Web push (M6.9): VAPID key for the browser, and its subscriptions. */
@Controller('notifications/push')
export class PushSubscriptionsController {
  constructor(private readonly push: WebPushService) {}

  @Get('key')
  key(): PushPublicKey {
    return { publicKey: this.push.publicKey };
  }

  @Post('subscriptions')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async subscribe(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<void> {
    await this.push.subscribe(auth.sub, parse(pushSubSchema, body));
  }

  @Delete('subscriptions')
  @HttpCode(204)
  @UseGuards(AccessTokenGuard)
  async unsubscribe(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<void> {
    await this.push.unsubscribe(
      auth.sub,
      parse(pushSubSchema.pick({ endpoint: true }), body).endpoint,
    );
  }

  /** Sends a test notification to the caller's browsers (Account → Notifications). */
  @Post('test')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  async test(@Auth() auth: AccessClaims): Promise<{ delivered: number }> {
    const delivered = await this.push.send(auth.sub, {
      title: 'ShopSphere notifications are on',
      body: 'You will get order updates in this browser.',
      url: '/account/notifications',
    });
    return { delivered };
  }
}
