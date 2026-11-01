import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { ReturnInfo, ReturnStatus, ReturnView, SellerReturn } from '@shopsphere/types';
import { z } from 'zod';
import { SellerGuard, SellerId } from '../fulfilment/seller.guard';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { ReturnsService } from './returns.service';

const REASONS = [
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'SIZE_FIT',
  'NO_LONGER_NEEDED',
] as const;
const STATUSES: [ReturnStatus, ...ReturnStatus[]] = [
  'REQUESTED',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
  'IN_TRANSIT',
  'RECEIVED',
  'QC_FAILED',
  'REFUNDED',
  'REPLACED',
];

const createSchema = z.object({
  reason: z.enum(REASONS),
  comment: z.string().max(500).optional(),
  refundTo: z.enum(['ORIGINAL', 'STORE_BALANCE']),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resolution: z.enum(['REFUND', 'REPLACE']).optional(),
});
const qcSchema = z.object({
  result: z.enum(['PASS', 'FAIL']),
  note: z.string().max(500).optional(),
});
const listSchema = z.object({ status: z.enum(STATUSES).optional() });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError('VALIDATION_FAILED', 'Invalid request', 422, r.error.issues);
  return r.data;
}

/** Shopper returns on "Your Orders" (M6.1). */
@Controller('orders/:id/return')
@UseGuards(AccessTokenGuard)
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  info(@Auth() auth: AccessClaims, @Param('id') id: string): Promise<ReturnInfo> {
    return this.returns.info(auth.sub, id);
  }

  @Post()
  create(
    @Auth() auth: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReturnView> {
    return this.returns.create(auth.sub, id, parse(createSchema, body));
  }
}

/** Seller Central returns: pickup re-booking and QC on receipt. */
@Controller('seller/returns')
@UseGuards(SellerGuard)
export class SellerReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  list(@SellerId() sellerId: string, @Query() q: unknown): Promise<{ items: SellerReturn[] }> {
    return this.returns.sellerList(sellerId, parse(listSchema, q).status);
  }

  @Post(':id/pickup')
  @HttpCode(200)
  pickup(@SellerId() sellerId: string, @Param('id') id: string): Promise<SellerReturn> {
    return this.returns.rebookPickup(sellerId, id);
  }

  @Post(':id/qc')
  @HttpCode(200)
  qc(
    @SellerId() sellerId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SellerReturn> {
    return this.returns.qc(sellerId, id, parse(qcSchema, body));
  }
}
