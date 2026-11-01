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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { CheckoutSession, PlaceOrderResponse } from '@shopsphere/types';
import type { Request } from 'express';
import { z } from 'zod';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { COOKIES } from '../identity/security/cookies.service';
import { RateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { Idempotent, IDEMPOTENCY_HEADER } from '../shared/idempotency/idempotency.interceptor';
import { WaitingRoomGuard } from '../waiting-room/waiting-room.module';
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
    removeLines: z
      .array(z.object({ skuId: UUID, sellerId: UUID }))
      .min(1)
      .max(50)
      .optional(),
  })
  .strict();

const placeSchema = z.object({
  expectedTotalPaise: z.number().int().min(0),
  /** Turnstile token, only needed after a CAPTCHA_REQUIRED (428) step-up. */
  captchaToken: z.string().max(2048).optional(),
});
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Checkout (M4.3–M4.9). Signed-in only; every total is computed server-side. */
@Controller('checkout')
@UseGuards(AccessTokenGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(WaitingRoomGuard)
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
  @RateLimit({ limit: 20, windowSeconds: 60, limitFrom: 'PLACE_ORDER_RATE_LIMIT_PER_MINUTE' })
  place(
    @Auth() auth: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers(IDEMPOTENCY_HEADER) key: string,
    @Req() req: Request,
  ): Promise<PlaceOrderResponse> {
    const { expectedTotalPaise, captchaToken } = placeSchema.parse(body);
    const device = req.cookies?.[COOKIES.device] as string | undefined;
    return this.checkout.placeOrder(auth.sub, id, key, expectedTotalPaise, {
      ip: req.ip ?? null,
      deviceId: device && DEVICE_ID.test(device) ? device : null,
      captchaToken,
    });
  }
}
