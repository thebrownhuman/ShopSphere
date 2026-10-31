import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../shared/errors/app-error';
import { OutboxService } from '../shared/outbox/outbox.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { offerChanged, productChanged } from './catalog-events';
import { CatalogInternalGuard } from './catalog.config';

const offerPatch = z
  .object({
    stockQty: z.number().int().min(0).optional(),
    price: z.number().int().positive().optional(),
    mrp: z.number().int().positive().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'empty patch');

const imageReady = z.object({ storageKey: z.string().min(1).max(300) });

/**
 * Worker / operator routes until Seller Central (M5) and admin (M6) own these writes.
 * Every catalog write enqueues an outbox event in the same transaction for the indexer.
 */
@Controller('catalog/internal')
@UseGuards(CatalogInternalGuard)
@SkipRateLimit()
export class CatalogInternalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  @Patch('offers/:id')
  async patchOffer(@Param('id') id: string, @Body() body: unknown) {
    const parsed = offerPatch.safeParse(body);
    if (!parsed.success)
      throw new AppError('VALIDATION_FAILED', 'Invalid offer patch', 400, parsed.error.issues);
    const { price, mrp, ...rest } = parsed.data;
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({ where: { id }, include: { sku: true } });
      if (!offer) throw new AppError('NOT_FOUND', 'Offer not found', HttpStatus.NOT_FOUND);
      if (rest.stockQty !== undefined && rest.stockQty < offer.reservedQty) {
        throw new AppError(
          'STOCK_BELOW_RESERVED',
          'stockQty cannot go below reserved quantity',
          409,
        );
      }
      const updated = await tx.offer.update({
        where: { id },
        data: {
          ...rest,
          ...(price !== undefined ? { price: BigInt(price) } : {}),
          ...(mrp !== undefined ? { mrp: BigInt(mrp) } : {}),
        },
      });
      const keys = Object.keys(parsed.data);
      await offerChanged(this.outbox, tx, {
        offerId: id,
        skuId: offer.skuId,
        productId: offer.sku.productId,
        stockOnly: keys.length === 1 && keys[0] === 'stockQty',
      });
      return {
        id: updated.id,
        stockQty: updated.stockQty,
        price: Number(updated.price),
        mrp: Number(updated.mrp),
        status: updated.status,
      };
    });
  }

  /** Image pipeline (M2.3): originals awaiting renditions. */
  @Get('images/pending')
  async pendingImages() {
    const rows = await this.prisma.productImage.findMany({
      where: { status: 'PENDING', storageKey: { not: null } },
      select: { id: true, storageKey: true, productId: true },
      take: 50,
    });
    return { images: rows };
  }

  @Post('images/:id/ready')
  @HttpCode(HttpStatus.OK)
  async imageReady(@Param('id') id: string, @Body() body: unknown) {
    const parsed = imageReady.safeParse(body);
    if (!parsed.success)
      throw new AppError('VALIDATION_FAILED', 'storageKey required', 400, parsed.error.issues);
    return this.markImage(id, { status: 'READY', storageKey: parsed.data.storageKey });
  }

  @Post('images/:id/failed')
  @HttpCode(HttpStatus.OK)
  imageFailed(@Param('id') id: string) {
    return this.markImage(id, { status: 'FAILED' });
  }

  private markImage(id: string, data: { status: string; storageKey?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const img = await tx.productImage.update({ where: { id }, data }).catch(() => null);
      if (!img) throw new AppError('NOT_FOUND', 'Image not found', HttpStatus.NOT_FOUND);
      await productChanged(this.outbox, tx, img.productId);
      return { id: img.id, status: img.status };
    });
  }
}
