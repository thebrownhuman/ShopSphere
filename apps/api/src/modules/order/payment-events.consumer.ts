import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ProcessedEventsService } from '../shared/events/processed-events.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { OrderService } from './order.service';

export const CONSUMER = 'orders.payment-events';
const POLL_MS = 1000;
const BATCH = 50;
/** Orders handled in parallel per batch; events of one order stay in created_at order (M7.5). */
const PARALLEL_ORDERS = Math.max(1, Number(process.env.PAYMENT_EVENTS_PARALLEL) || 8);
/**
 * The scan starts at the oldest pending event seen last time minus this margin, instead of
 * re-reading three days of handled events every second (O(events) per tick before M7.5). The
 * margin covers outbox rows committed after later-created ones (transactions are far shorter).
 */
const WATERMARK_MARGIN_MS = 5 * 60_000;
const LOOKBACK_MS = 3 * 86_400_000;

interface Row {
  id: string;
  created_at: Date;
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
  private watermark = 0;

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
      const startedAt = Date.now();
      const since = new Date(Math.max(startedAt - LOOKBACK_MS, this.watermark));
      const rows = await this.prisma.$queryRaw<Row[]>`
        SELECT o.id::text, o.created_at, o.event_type, o.payload FROM outbox_events o
        WHERE o.aggregate_type = 'payment'
          AND o.event_type IN ('payment.captured', 'payment.failed')
          AND o.created_at > ${since}
          AND NOT EXISTS (SELECT 1 FROM processed_events p
                          WHERE p.consumer = ${CONSUMER} AND p.event_id = o.id::text)
        ORDER BY o.created_at, o.id
        LIMIT ${BATCH}`;
      this.watermark = (rows[0]?.created_at.getTime() ?? startedAt) - WATERMARK_MARGIN_MS;
      if (rows.length === 0) return total;
      total += await this.handleBatch(rows);
      if (rows.length < BATCH) return total;
    }
  }

  /** One chain per order (in order), up to PARALLEL_ORDERS chains at a time. */
  private async handleBatch(rows: Row[]): Promise<number> {
    const byOrder = new Map<string, Row[]>();
    for (const row of rows) {
      const key = row.payload.orderId ?? row.id;
      byOrder.set(key, [...(byOrder.get(key) ?? []), row]);
    }
    const chains = [...byOrder.values()];
    let applied = 0;
    const worker = async () => {
      for (let chain = chains.shift(); chain; chain = chains.shift()) {
        for (const row of chain) if (await this.handle(row)) applied += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_ORDERS, chains.length) }, worker));
    return applied;
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
