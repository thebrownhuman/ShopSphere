import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProcessedEventsService } from '../shared/events/processed-events.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { NOTIFICATION_CHANNELS, type NotificationChannels } from './channels';
import { NOTIFICATION_CONFIG, type NotificationConfig } from './notification.config';
import { PreferencesStore } from './preferences';
import { renderNotification, type NotificationEvent } from './templates';

const CONSUMER = 'notification.order-events';
const FEED_PAGE = 100;

export interface DispatchResult {
  /** False when the event was already processed (redelivery). */
  processed: boolean;
  sent: string[];
}

export interface FeedEvent {
  id: string;
  type: string;
  occurredAt: string;
  payload: unknown;
}

/**
 * Notifications v1 (M4.31): renders the template for an order event, applies the recipient's
 * preferences and sends email + SMS. At most once per event id: the processed-event marker and
 * the sends share one transaction, so a failed send rolls the marker back and the worker retries.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannels,
    @Inject(NOTIFICATION_CONFIG) private readonly cfg: NotificationConfig,
    private readonly prefs: PreferencesStore,
    private readonly processed: ProcessedEventsService,
    private readonly prisma: PrismaService,
  ) {}

  async dispatch(event: NotificationEvent): Promise<DispatchResult> {
    const sent: string[] = [];
    const processed = await this.processed.runOnce(CONSUMER, event.id, async () => {
      const msg = renderNotification(event, this.cfg.WEB_URL);
      const { recipient } = event.payload;
      const prefs = (await this.prefs.get(recipient.userId))[msg.category];
      if (recipient.email && (prefs.email || msg.emailMandatory)) {
        await this.channels.email(recipient.email, msg.email.subject, msg.email.text);
        sent.push('email');
      }
      if (recipient.phone && prefs.sms) {
        await this.channels.sms(recipient.phone, msg.sms);
        sent.push('sms');
      }
    });
    if (!processed) this.logger.log(`event ${event.id} already processed`);
    return { processed, sent };
  }

  /**
   * Order events after `after` (an outbox event id), oldest first. Without a cursor the feed
   * starts at the newest event, so a fresh worker does not replay history.
   */
  async feed(
    types: string[],
    after?: string,
  ): Promise<{ events: FeedEvent[]; cursor: string | null }> {
    if (!after) {
      const latest = await this.prisma.outboxEvent.findFirst({
        where: { eventType: { in: types } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      return { events: [], cursor: latest?.id ?? null };
    }
    const from = await this.prisma.outboxEvent.findUnique({
      where: { id: after },
      select: { createdAt: true },
    });
    const rows = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: { in: types },
        ...(from
          ? {
              OR: [
                { createdAt: { gt: from.createdAt } },
                { createdAt: from.createdAt, id: { gt: after } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: FEED_PAGE,
    });
    return {
      events: rows.map((r) => ({
        id: r.id,
        type: r.eventType,
        occurredAt: r.createdAt.toISOString(),
        payload: r.payload,
      })),
      cursor: rows.at(-1)?.id ?? after,
    };
  }
}
