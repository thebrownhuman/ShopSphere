import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/config.service';
import { PrismaService } from '../prisma/prisma.service';

const BATCH_SIZE = 100;
const POLL_MS = 1000;

/**
 * Relays unpublished outbox rows. STUB: logs and marks rows published.
 * TODO(M1+): push to BullMQ queues; use FOR UPDATE SKIP LOCKED when running >1 replica.
 */
@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('OUTBOX_PUBLISHER_ENABLED')) return;
    this.timer = setInterval(() => void this.publishBatch(), POLL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async publishBatch(): Promise<number> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    for (const event of events) {
      try {
        this.logger.log({ id: event.id, type: event.eventType }, 'outbox publish (stub)');
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), attempts: { increment: 1 } },
        });
      } catch (err) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, lastError: String(err) },
        });
      }
    }
    return events.length;
  }
}
