import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { OrderDetail, OrdersPage, OrderStatusResponse } from '@shopsphere/types';
import { z } from 'zod';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { InternalTokenGuard } from '../payment/payment.controller';
import { PAYMENT_CONFIG, type PaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { AppError } from '../shared/errors/app-error';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { ORDER_STATUSES } from './order-state';
import { OrderService } from './order.service';
import { OrderWorker } from './order.worker';

const listSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  status: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(ORDER_STATUSES as [string, ...string[]])))
    .optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const cancelSchema = z.object({ reason: z.string().max(200).optional() });
const testPaymentSchema = z.object({
  outcome: z.enum(['success', 'failure', 'pending', 'late_capture']),
});

/** Customer orders (M4.27–M4.29). */
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orders: OrderService,
    private readonly payments: PaymentService,
    private readonly worker: OrderWorker,
    @Inject(PAYMENT_CONFIG) private readonly payCfg: PaymentConfig,
  ) {}

  @Get()
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'no-store')
  list(@Auth() auth: AccessClaims, @Query() query: unknown): Promise<OrdersPage> {
    const q = listSchema.parse(query);
    return this.orders.list(auth.sub, { ...q, status: q.status as never });
  }

  @Get(':id')
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'no-store')
  detail(@Auth() auth: AccessClaims, @Param('id') id: string): Promise<OrderDetail> {
    return this.orders.detail(auth.sub, id);
  }

  /** Polled every 3 s by the "Confirming your payment…" page. */
  @Get(':id/status')
  @UseGuards(AccessTokenGuard)
  @SkipRateLimit()
  @Header('Cache-Control', 'no-store')
  status(@Auth() auth: AccessClaims, @Param('id') id: string): Promise<OrderStatusResponse> {
    return this.orders.status(auth.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  cancel(
    @Auth() auth: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<OrderDetail> {
    return this.orders.cancel(auth.sub, id, cancelSchema.parse(body ?? {}).reason);
  }

  /**
   * M4.36 staging/QA toggle: force a payment outcome on your own PENDING_PAYMENT order.
   * late_capture closes the payment window first (stock released), then captures.
   * 404 in production.
   */
  @Post(':id/test-payment')
  @HttpCode(200)
  @UseGuards(AccessTokenGuard)
  async testPayment(@Auth() auth: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    if (!this.payCfg.testToggle) throw new AppError('NOT_FOUND', 'Not found', HttpStatus.NOT_FOUND);
    const { outcome } = testPaymentSchema.parse(body);
    await this.orders.detail(auth.sub, id); // ownership
    if (outcome === 'late_capture') await this.orders.expire(id, new Date(), true);
    const result = await this.payments.simulate(
      id,
      outcome === 'late_capture' ? 'success' : outcome,
    );
    return { ...result, order: await this.orders.status(auth.sub, id) };
  }

  /** apps/workers hook for the expiry/refund sweep (also runs in-process every 30 s). */
  @Post('internal/sweep')
  @HttpCode(200)
  @SkipRateLimit()
  @UseGuards(InternalTokenGuard)
  sweep() {
    return this.worker.sweep();
  }
}
