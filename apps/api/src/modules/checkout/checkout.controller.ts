import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { CheckoutSession, PlaceOrderResponse } from '@shopsphere/types';
import { z } from 'zod';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { Idempotent, IDEMPOTENCY_HEADER } from '../shared/idempotency/idempotency.interceptor';
import { CheckoutService } from './checkout.service';

const UUID = z.string().uuid();

const createSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('CART'), addressId: UUID.optional() }),
  z.object({
    source: z.literal('BUY_NOW'),
    skuId: UUID,
    sellerId: UUID.optional(),
    qty: z.number().int().min(1).max(100),
    addressId: UUID.optional(),
  }),
]);

const updateSchema = z
  .object({
    addressId: UUID.optional(),
    deliveryOptions: z
      .array(
        z.object({
          shipmentKey: z.string().max(80),
          type: z.enum(['STANDARD', 'ONE_DAY', 'SCHEDULED']),
          slotDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
      )
      .max(50)
      .optional(),
    paymentMethod: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('ONLINE'), provider: z.enum(['razorpay', 'bank']) }),
        z.object({ type: z.literal('COD') }),
      ])
      .nullable()
      .optional(),
    couponCode: z.string().max(40).nullable().optional(),
    useStoreBalance: z.boolean().optional(),
  })
  .strict();

const placeSchema = z.object({ expectedTotalPaise: z.number().int().min(0) });

/** Checkout (M4.3–M4.9). Signed-in only; every total is computed server-side. */
@Controller('checkout')
@UseGuards(AccessTokenGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @HttpCode(201)
  create(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<CheckoutSession> {
    return this.checkout.create(auth.sub, createSchema.parse(body));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Auth() auth: AccessClaims, @Param('id') id: string): Promise<CheckoutSession> {
    return this.checkout.get(auth.sub, id);
  }

  @Patch(':id')
  update(
    @Auth() auth: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<CheckoutSession> {
    return this.checkout.update(auth.sub, id, updateSchema.parse(body));
  }

  /** Idempotency-Key required: replays answer with the same order (HTTP layer + orders unique key). */
  @Post(':id/place-order')
  @HttpCode(201)
  @Idempotent()
  place(
    @Auth() auth: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) key: string,
  ): Promise<PlaceOrderResponse> {
    return this.checkout.placeOrder(auth.sub, id, key, placeSchema.parse(body).expectedTotalPaise);
  }
}
