import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type {
  SellerOrdersPage,
  SellerShipment,
  SellerShipmentDetail,
  ShipmentStatus,
} from '@shopsphere/types';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { InternalTokenGuard } from '../payment/payment.controller';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { ServiceabilityService } from '../shipping/serviceability.service';
import { FulfilmentService } from './fulfilment.service';
import { SellerGuard, SellerId } from './seller.guard';

const STATUSES: [ShipmentStatus, ...ShipmentStatus[]] = [
  'PENDING',
  'CONFIRMED',
  'ACCEPTED',
  'PACKED',
  'LABEL_CREATED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
];
const listSchema = z.object({
  status: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(STATUSES)))
    .optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const packSchema = z.object({ weightGrams: z.number().int().min(1).max(50_000).optional() });

/** Seller order queue (M5.5). One row per shipment: the seller's part of an order. */
@Controller('seller')
@UseGuards(SellerGuard)
export class SellerOrdersController {
  constructor(private readonly fulfilment: FulfilmentService) {}

  @Get('orders')
  @Header('Cache-Control', 'no-store')
  list(@SellerId() sellerId: string, @Query() q: unknown): Promise<SellerOrdersPage> {
    return this.fulfilment.list(sellerId, listSchema.parse(q));
  }

  @Post('orders/:id/accept')
  @HttpCode(200)
  accept(@SellerId() sellerId: string, @Param('id') id: string): Promise<SellerShipment> {
    return this.fulfilment.accept(sellerId, id);
  }

  @Post('orders/:id/pack')
  @HttpCode(200)
  pack(
    @SellerId() sellerId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<SellerShipment> {
    return this.fulfilment.pack(sellerId, id, packSchema.parse(body ?? {}).weightGrams);
  }

  @Post('orders/:id/label')
  @HttpCode(200)
  label(@SellerId() sellerId: string, @Param('id') id: string): Promise<SellerShipment> {
    return this.fulfilment.label(sellerId, id);
  }

  @Get('shipments/:id')
  @Header('Cache-Control', 'no-store')
  detail(@SellerId() sellerId: string, @Param('id') id: string): Promise<SellerShipmentDetail> {
    return this.fulfilment.detail(sellerId, id);
  }

  @Get('shipments/:id/label.pdf')
  async labelPdf(
    @SellerId() sellerId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { awb, pdf } = await this.fulfilment.labelPdf(sellerId, id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${awb}.pdf"`);
    res.end(pdf);
  }
}

/** Courier tracking webhooks. Signature is checked over the exact raw body. */
@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly fulfilment: FulfilmentService,
    private readonly serviceability: ServiceabilityService,
  ) {}

  @Post('webhooks/:provider')
  @HttpCode(200)
  @SkipRateLimit()
  webhook(@Param('provider') provider: string, @Req() req: RawBodyRequest<Request>) {
    return this.fulfilment.handleWebhook(provider, req.rawBody, req.headers);
  }

  /** apps/workers: recover missed tracking webhooks. */
  @Post('internal/sync-tracking')
  @HttpCode(200)
  @SkipRateLimit()
  @UseGuards(InternalTokenGuard)
  syncTracking() {
    return this.fulfilment.syncTracking();
  }

  /** apps/workers nightly: refresh courier serviceability + SLA (M5.6a). */
  @Post('internal/refresh-serviceability')
  @HttpCode(200)
  @SkipRateLimit()
  @UseGuards(InternalTokenGuard)
  refreshServiceability() {
    return this.serviceability.refresh();
  }
}
