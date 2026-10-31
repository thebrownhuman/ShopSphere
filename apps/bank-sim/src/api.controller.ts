import {
  ArgumentsHost,
  Body,
  CanActivate,
  Catch,
  Controller,
  ExceptionFilter,
  ExecutionContext,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Injectable,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { BankError, BankService } from './bank.service';
import { config } from './config';

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Merchant API auth: HTTP Basic key_id:key_secret, like Razorpay. */
@Injectable()
export class MerchantAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest<Request>().header('authorization') ?? '';
    const [scheme, encoded] = header.split(' ');
    const [keyId, secret] = Buffer.from(encoded ?? '', 'base64')
      .toString()
      .split(':');
    if (
      scheme !== 'Basic' ||
      !safeEqual(keyId ?? '', config.keyId) ||
      !safeEqual(secret ?? '', config.keySecret)
    ) {
      throw new BankError(401, 'authentication failed');
    }
    return true;
  }
}

/** Razorpay-style error body: {error: {code, description}}. */
@Catch()
export class BankErrorFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      err instanceof BankError ? err.status : err instanceof HttpException ? err.getStatus() : 500;
    const description = err instanceof Error ? err.message : 'internal error';
    res.status(status).json({
      error: {
        code:
          status === 401 ? 'UNAUTHORIZED' : status >= 500 ? 'SERVER_ERROR' : 'BAD_REQUEST_ERROR',
        description,
      },
    });
  }
}

@Controller('v1')
@UseGuards(MerchantAuthGuard)
export class MerchantApiController {
  constructor(private readonly bank: BankService) {}

  @Post('orders')
  @HttpCode(200)
  createOrder(@Body() body: Record<string, unknown>, @Headers('idempotency-key') key?: string) {
    return this.bank.createOrder(body ?? {}, key);
  }

  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.bank.getOrder(id);
  }

  @Get('orders/:id/payments')
  orderPayments(@Param('id') id: string) {
    this.bank.getOrder(id);
    const items = this.bank.paymentsForOrder(id);
    return { entity: 'collection', count: items.length, items };
  }

  @Post('payouts')
  @HttpCode(200)
  createPayout(@Body() body: Record<string, unknown>, @Headers('idempotency-key') key?: string) {
    return this.bank.createPayout(body ?? {}, key);
  }

  @Get('payouts/:id')
  payout(@Param('id') id: string) {
    return this.bank.getPayout(id);
  }

  @Get('payments/:id')
  payment(@Param('id') id: string) {
    return this.bank.getPayment(id);
  }

  @Post('payments/:id/capture')
  @HttpCode(200)
  capture(@Param('id') id: string, @Body() body: { amount?: unknown }) {
    return this.bank.merchantCapture(id, body?.amount);
  }

  @Post('payments/:id/refund')
  @HttpCode(200)
  refund(
    @Param('id') id: string,
    @Body() body: { amount?: unknown; receipt?: unknown },
    @Headers('idempotency-key') key?: string,
  ) {
    return this.bank.refund(id, body ?? {}, key);
  }
}
