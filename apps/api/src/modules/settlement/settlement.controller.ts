import { Controller, Get, Header, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { SellerPayoutDetail, SellerPayoutsPage, SellerStatement } from '@shopsphere/types';
import { z } from 'zod';
import { SellerGuard, SellerId } from '../fulfilment/seller.guard';
import { InternalTokenGuard } from '../payment/payment.controller';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { SettlementService } from './settlement.service';

const pageSchema = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const statementSchema = z
  .object({ from: day, to: day })
  .refine((q) => q.from <= q.to, { message: 'from must not be after to' });

/** Seller payouts and statements (M5.7). */
@Controller('seller')
@UseGuards(SellerGuard)
export class SellerPayoutsController {
  constructor(private readonly settlement: SettlementService) {}

  @Get('payouts')
  @Header('Cache-Control', 'no-store')
  payouts(@SellerId() sellerId: string, @Query() q: unknown): Promise<SellerPayoutsPage> {
    const { cursor, limit } = pageSchema.parse(q);
    return this.settlement.payouts(sellerId, cursor, limit);
  }

  @Get('payouts/:id')
  @Header('Cache-Control', 'no-store')
  payout(@SellerId() sellerId: string, @Param('id') id: string): Promise<SellerPayoutDetail> {
    return this.settlement.payout(sellerId, id);
  }

  @Get('statements')
  @Header('Cache-Control', 'no-store')
  statement(@SellerId() sellerId: string, @Query() q: unknown): Promise<SellerStatement> {
    const { from, to } = statementSchema.parse(q);
    return this.settlement.statement(sellerId, from, to);
  }
}

/** apps/workers daily payout hook. */
@Controller('settlement/internal')
export class SettlementInternalController {
  constructor(private readonly settlement: SettlementService) {}

  @Post('run-payouts')
  @HttpCode(200)
  @SkipRateLimit()
  @UseGuards(InternalTokenGuard)
  runPayouts() {
    return this.settlement.runPayouts();
  }
}
