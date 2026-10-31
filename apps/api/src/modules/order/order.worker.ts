import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../shared/prisma/prisma.service';
import { OrderService } from './order.service';

const SWEEP_MS = 30_000;

/**
 * In-process schedule for order housekeeping (M4.2): closes unpaid payment windows (releasing
 * stock), extends windows with a pending payment (M4.35), expires idle checkout sessions and
 * retries refunds for cancelled orders. Also exposed as POST /orders/internal/sweep for
 * apps/workers. Off with ORDER_WORKERS_ENABLED=false (tests drive sweep() directly).
 */
@Injectable()
export class OrderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OrderWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly orders: OrderService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    if (process.env.ORDER_WORKERS_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.tick(), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.sweep();
      if (r.expired || r.extended || r.refundsRequested) this.log.log(r, 'order sweep');
    } catch (err) {
      this.log.warn(`order sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async sweep(now = new Date()) {
    const { expired, extended } = await this.orders.expireDue(now);
    const { count: sessionsExpired } = await this.prisma.checkoutSession.updateMany({
      where: { status: 'OPEN', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    const refundsRequested = await this.orders.refundSweep();
    return { expired, extended, sessionsExpired, refundsRequested };
  }
}
