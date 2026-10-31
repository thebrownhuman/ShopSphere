import { Controller, Get, Header, HttpStatus, Injectable, Query } from '@nestjs/common';
import type { DeliveryEstimateResponse } from '@shopsphere/types';
import { rankOffers } from '../catalog/product-loader';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { estimateDelivery, isValidPincode } from './delivery-estimate';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DeliveryService {
  constructor(private readonly prisma: PrismaService) {}

  async estimate(
    skuId: string,
    pincode: string,
    offerId?: string,
    now = new Date(),
  ): Promise<DeliveryEstimateResponse> {
    if (!UUID.test(skuId)) throw new AppError('VALIDATION_FAILED', 'sku must be a UUID', 400);
    if (!isValidPincode(pincode)) {
      throw new AppError('INVALID_PINCODE', 'Enter a valid 6-digit pincode', 400);
    }
    const [pin, offers] = await Promise.all([
      this.prisma.pincode.findUnique({ where: { pincode } }),
      this.prisma.offer.findMany({ where: { skuId }, include: { seller: true } }),
    ]);
    const ranked = rankOffers(offers);
    const offer = offerId ? ranked.find((o) => o.id === offerId) : ranked[0];
    const base = {
      skuId,
      pincode,
      city: pin?.city ?? null,
      state: pin?.state ?? null,
      offerId: offer?.id ?? null,
    };
    // Unknown-but-valid pincodes are treated as serviceable in this simulation; only rows
    // explicitly marked unserviceable (islands, high-altitude) are refused.
    if (!offer || pin?.serviceable === false) {
      if (!offer && offers.length === 0)
        throw new AppError('NOT_FOUND', 'SKU not found', HttpStatus.NOT_FOUND);
      return {
        ...base,
        serviceable: false,
        zone: null,
        deliveryDate: null,
        slaDays: null,
        cutoffAt: null,
        cutoffSecondsRemaining: null,
        freeDelivery: false,
        deliveryFee: 0,
      };
    }
    const e = estimateDelivery({
      fromPin: offer.seller.pincode,
      toPin: pincode,
      fulfilledByShopSphere: offer.fulfilment === 'SHOPSPHERE',
      cutoffHour: offer.seller.cutoffHour,
      pricePaise: Number(offer.price),
      now,
    });
    return {
      ...base,
      serviceable: true,
      zone: e.zone,
      deliveryDate: e.deliveryDate,
      slaDays: e.slaDays,
      cutoffAt: e.cutoffAt.toISOString(),
      cutoffSecondsRemaining: e.cutoffSecondsRemaining,
      freeDelivery: e.freeDelivery,
      deliveryFee: e.deliveryFee,
    };
  }
}

@Controller('delivery-estimate')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  estimate(
    @Query('sku') sku = '',
    @Query('pincode') pincode = '',
    @Query('offerId') offerId?: string,
  ): Promise<DeliveryEstimateResponse> {
    return this.delivery.estimate(sku, pincode.trim(), offerId);
  }
}
