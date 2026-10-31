import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrderModule } from '../order/order.module';
import { MailpitChannels, NOTIFICATION_CHANNELS } from './channels';
import { NOTIFICATION_DIRECTORY, PrismaNotificationDirectory } from './directory';
import {
  NotificationInternalController,
  NotificationPreferencesController,
  PushSubscriptionsController,
} from './notification.controller';
import { WebPushService } from './web-push.service';
import {
  loadNotificationConfig,
  NOTIFICATION_CONFIG,
  NotificationInternalGuard,
} from './notification.config';
import { NotificationService } from './notification.service';
import { PreferencesStore } from './preferences';

/**
 * Notifications (M4.31): order lifecycle email + SMS from outbox events, templates and
 * per-shopper preferences. Workers pull the event feed and post each event to /dispatch.
 */
@Module({
  imports: [IdentityModule, OrderModule],
  controllers: [
    NotificationInternalController,
    NotificationPreferencesController,
    PushSubscriptionsController,
  ],
  providers: [
    { provide: NOTIFICATION_CONFIG, useFactory: () => loadNotificationConfig(process.env) },
    { provide: NOTIFICATION_CHANNELS, useClass: MailpitChannels },
    { provide: NOTIFICATION_DIRECTORY, useClass: PrismaNotificationDirectory },
    NotificationInternalGuard,
    NotificationService,
    PreferencesStore,
    WebPushService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
