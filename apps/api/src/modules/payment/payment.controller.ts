import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppConfig } from '../shared/config/config.service';
import { AppError } from '../shared/errors/app-error';
import { Idempotent, IDEMPOTENCY_HEADER } from '../shared/idempotency/idempotency.interceptor';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { PROVIDERS } from './domain/payment.types';
import { PAYABLE_ORDER_SOURCE, StubOrderSource } from './orders/payable-order-source';
import { PAYMENT_CONFIG, PaymentConfig } from './payment.config';
import { PaymentService } from './payment.service';
import { ProviderRegistry } from './providers/provider.registry';

const orderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'invalid order id');

const initiateSchema = z.object({
  provider: z.enum(PROVIDERS),
  /** Where the gateway sends the shopper back; must be one of CORS_ORIGINS. */
  returnUrl: z.string().url(),
});

const verifySchema = z.object({
  provider: z.enum(PROVIDERS),
  providerOrderId: z.string().min(1).max(64),
  providerPaymentId: z.string().min(1).max(64),
  signature: z.string().min(1).max(256),
});

const refundSchema = z.object({
  amountPaise: z.number().int().positive(),
});

const devOrderSchema = z.object({
  orderId: orderIdSchema.optional(),
  amountPaise: z.number().int().min(100).max(50_000_000),
  status: z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED']).optional(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Request validation failed',
      HttpStatus.BAD_REQUEST,
      result.error.issues,
    );
  }
  return result.data;
}

/** Guards internal routes (worker reconcile, manual refunds) until admin RBAC exists (M6). */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(@Inject(PAYMENT_CONFIG) private readonly cfg: PaymentConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(
      ctx.switchToHttp().getRequest<Request>().header('x-internal-token') ?? '',
    );
    const expected = Buffer.from(this.cfg.PAYMENT_INTERNAL_TOKEN);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError('UNAUTHORIZED', 'Internal token required', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    private readonly providers: ProviderRegistry,
    private readonly config: AppConfig,
    @Inject(PAYMENT_CONFIG) private readonly cfg: PaymentConfig,
    @Inject(PAYABLE_ORDER_SOURCE) private readonly orders: StubOrderSource,
  ) {}

  @Get('providers')
  providerList() {
    return { providers: this.providers.available() };
  }

  /** Dev-only: register a stub order until the orders module exists. */
  @Post('dev/orders')
  devOrder(@Body() body: unknown) {
    if (!this.cfg.devRoutes) throw new AppError('NOT_FOUND', 'Not found', HttpStatus.NOT_FOUND);
    const input = parse(devOrderSchema, body);
    const order = this.orders.register(
      input.orderId ?? `dev_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      BigInt(input.amountPaise),
      input.status,
    );
    return { ...order, amountPaise: Number(order.amountPaise) };
  }

  @Post(':orderId/initiate')
  @Idempotent()
  initiate(
    @Param('orderId') orderId: string,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) key: string,
  ) {
    const input = parse(initiateSchema, body);
    const allowed = this.config.get('CORS_ORIGINS').split(',');
    if (!allowed.includes(new URL(input.returnUrl).origin)) {
      throw new AppError('RETURN_URL_NOT_ALLOWED', 'returnUrl origin is not allowed');
    }
    return this.payments.initiate(
      parse(orderIdSchema, orderId),
      input.provider,
      key,
      input.returnUrl,
    );
  }

  @Post(':orderId/verify')
  @HttpCode(200)
  verify(@Param('orderId') orderId: string, @Body() body: unknown) {
    return this.payments.verifyReturn(parse(orderIdSchema, orderId), parse(verifySchema, body));
  }

  @Get(':orderId/status')
  @SkipRateLimit()
  status(@Param('orderId') orderId: string) {
    return this.payments.status(parse(orderIdSchema, orderId));
  }

  @Post(':orderId/refunds')
  @Idempotent()
  @UseGuards(InternalTokenGuard)
  refund(@Param('orderId') orderId: string, @Body() body: unknown) {
    const input = parse(refundSchema, body);
    return this.payments.requestRefund(parse(orderIdSchema, orderId), BigInt(input.amountPaise));
  }

  @Post('internal/reconcile')
  @HttpCode(200)
  @SkipRateLimit()
  @UseGuards(InternalTokenGuard)
  reconcile() {
    return this.payments.reconcile();
  }
}

/** Gateway webhooks. Signature is checked over the exact raw body, so rawBody must be enabled. */
@Controller('payments/webhooks')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post(':provider')
  @HttpCode(200)
  @SkipRateLimit()
  receive(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.payments.handleWebhook(provider, req.rawBody, req.headers);
  }
}
