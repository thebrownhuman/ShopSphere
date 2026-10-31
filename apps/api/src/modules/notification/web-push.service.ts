import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PushSubscriptionRequest } from '@shopsphere/types';
import { sendNotification } from 'web-push';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NOTIFICATION_CONFIG, type NotificationConfig } from './notification.config';

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is clicked. */
  url: string;
  /** Collapses repeated notifications for the same order. */
  tag?: string;
}

/**
 * Web Push (M6.9): VAPID-signed messages to the browsers a shopper subscribed from apps/web
 * (service worker public/sw.js). Disabled when VAPID keys are not configured.
 */
@Injectable()
export class WebPushService {
  private readonly log = new Logger('WebPush');

  constructor(
    @Inject(NOTIFICATION_CONFIG) private readonly cfg: NotificationConfig,
    private readonly prisma: PrismaService,
  ) {}

  get publicKey(): string | null {
    return this.enabled ? this.cfg.VAPID_PUBLIC_KEY! : null;
  }

  get enabled(): boolean {
    return !!(this.cfg.VAPID_PUBLIC_KEY && this.cfg.VAPID_PRIVATE_KEY);
  }

  async subscribe(userId: string, sub: PushSubscriptionRequest): Promise<void> {
    const data = { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, ...data },
      update: data,
    });
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /** Sends to every subscribed browser; returns how many accepted it. Gone endpoints are pruned. */
  async send(userId: string, msg: PushMessage): Promise<number> {
    if (!this.enabled) return 0;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    let delivered = 0;
    for (const s of subs) {
      try {
        await sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          {
            vapidDetails: {
              subject: this.cfg.VAPID_SUBJECT,
              publicKey: this.cfg.VAPID_PUBLIC_KEY!,
              privateKey: this.cfg.VAPID_PRIVATE_KEY!,
            },
            TTL: 24 * 3600,
          },
        );
        delivered += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        } else {
          // Push is best effort: never fail (and so re-send email/SMS for) the event over it.
          this.log.warn(`push to ${s.id} failed: ${(err as Error).message}`);
        }
      }
    }
    return delivered;
  }
}
