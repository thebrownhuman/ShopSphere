import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ProcessedEventsService } from '../shared/events/processed-events.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { OrderService } from './order.service';

export const CONSUMER = 'orders.payment-events';
const POLL_MS = 1000;
const BATCH = 50;

interface Row {
  id: string;
  event_type: string;
  payload: { orderId?: string; provider?: string; reason?: string | null };
}

/**
 * Applies payment outcomes to orders (M4.15/M4.16/M4.34). The payment module writes
 * `payment.captured` / `payment.failed` to the outbox in the same transaction as the money state;
 * this consumer reads them straight from `outbox_events` (independent of the relay, which is still
 * a stub) and handles each at most once via processed_events, inside one transaction with the
 * order changes. Refunds that follow (capture on a cancelled order, late capture without stock)
 * are requested after commit; OrderService.refundSweep() covers a crash in between.
 */
@Injectable()
export class PaymentEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaymentEventsConsumer.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processed: ProcessedEventsService,
    private readonly orders: OrderService,
  ) {}

  onModuleInit(): void {
    if (process.env.ORDER_WORKERS_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.drain();
    } catch (err) {
      this.log.warn(`payment events drain failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Processes everything pending; returns how many events were applied. Tests call this directly. */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.prisma.$queryRaw<Row[]>`
        SELECT o.id::text, o.event_type, o.payload FROM outbox_events o
        WHERE o.aggregate_type = 'payment'
          AND o.event_type IN ('payment.captured', 'payment.failed')
          AND o.created_at > now() - interval '3 days'
          AND NOT EXISTS (SELECT 1 FROM processed_events p
                          WHERE p.consumer = ${CONSUMER} AND p.event_id = o.id::text)
        ORDER BY o.created_at, o.id
        LIMIT ${BATCH}`;
      if (rows.length === 0) return total;
      for (const row of rows) {
        if (await this.handle(row)) total += 1;
      }
      if (rows.length < BATCH) return total;
    }
  }

  private async handle(row: Row): Promise<boolean> {
    const orderId = row.payload.orderId;
    let refund = false;
    const ran = await this.processed.runOnce(CONSUMER, row.id, async (tx) => {
      if (!orderId) return;
      if (row.event_type === 'payment.captured') {
        refund = (await this.orders.onPaymentCaptured(tx, orderId)).refund;
      } else {
        await this.orders.onPaymentFailed(tx, orderId, {
          provider: row.payload.provider ?? 'unknown',
          reason: row.payload.reason ?? null,
        });
      }
    });
    if (ran && refund && orderId) await this.orders.refundRemaining(orderId);
    return ran;
  }
}
