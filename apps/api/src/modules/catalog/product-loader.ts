import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OfferView, ProductCard, StockStatus } from '@shopsphere/types';
import { slaDays } from '../delivery/delivery-estimate';
import { scoreOffers } from '../pricing/buy-box';
import { priceInfo } from '../pricing/pricing';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CATALOG_CONFIG, CatalogConfig } from './catalog.config';
import { CategoryTreeService } from './category-tree.service';
import { imageSet } from './media';

export const PRODUCT_INCLUDE = {
  brand: true,
  images: { orderBy: { position: 'asc' } },
  skus: {
    orderBy: { position: 'asc' },
    include: { offers: { include: { seller: true } } },
  },
} satisfies Prisma.ProductInclude;

export type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;
export type OfferRow = ProductRow['skus'][number]['offers'][number];

export const LOW_STOCK_THRESHOLD = 5;

export interface RankedSku {
  sku: ProductRow['skus'][number];
  /** Buyable offers, buy-box winner first. */
  ranked: OfferRow[];
}

/** Product plus everything derived for display: GST rate, ranked offers per SKU. */
export interface LoadedProduct {
  row: ProductRow;
  gstBp: number;
  skus: RankedSku[];
  /** Default SKU: flagged default with a live offer, else first with a live offer, else first. */
  defaultSku: RankedSku;
}

export function offerBaseSla(o: { fulfilment: string }): number {
  return slaDays('METRO', o.fulfilment === 'SHOPSPHERE');
}

export function stockStatus(available: number): { status: StockStatus; low?: number } {
  if (available <= 0) return { status: 'OUT_OF_STOCK' };
  if (available <= LOW_STOCK_THRESHOLD) return { status: 'LOW_STOCK', low: available };
  return { status: 'IN_STOCK' };
}

export function rankOffers(offers: OfferRow[]): OfferRow[] {
  return scoreOffers(
    offers.map((o) => ({
      id: o.id,
      price: o.price,
      stockQty: o.stockQty,
      reservedQty: o.reservedQty,
      status: o.status,
      sellerStatus: o.seller.status,
      sellerRatingX10: o.seller.ratingX10,
      isFirstParty: o.seller.isFirstParty,
      slaDays: offerBaseSla(o),
      row: o,
    })),
  ).map((s) => s.offer.row);
}

@Injectable()
export class ProductLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoryTreeService,
    @Inject(CATALOG_CONFIG) private readonly cfg: CatalogConfig,
  ) {}

  get bases() {
    return { media: this.cfg.MEDIA_BASE_URL, api: this.cfg.API_URL };
  }

  async enrich(row: ProductRow): Promise<LoadedProduct> {
    const gstBp = await this.categories.gstBp(row.categoryId);
    const skus = row.skus.map((sku) => ({ sku, ranked: rankOffers(sku.offers) }));
    const defaultSku =
      skus.find((s) => s.sku.isDefault && s.ranked.length > 0) ??
      skus.find((s) => s.ranked.length > 0) ??
      skus[0];
    return { row, gstBp, skus, defaultSku };
  }

  async loadMany(ids: string[]): Promise<LoadedProduct[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE' },
      include: PRODUCT_INCLUDE,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const out: LoadedProduct[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row && row.skus.length > 0) out.push(await this.enrich(row));
    }
    return out;
  }

  /** Cards in the order of `ids`; unknown or inactive ids are skipped. */
  async cards(ids: string[]): Promise<ProductCard[]> {
    return (await this.loadMany(ids)).map((p) => this.card(p));
  }

  card(p: LoadedProduct): ProductCard {
    const sku = p.defaultSku;
    const best = sku.ranked[0];
    const img =
      p.row.images.find((i) => i.skuId === sku.sku.id && i.status === 'READY') ??
      p.row.images.find((i) => i.status === 'READY');
    return {
      productId: p.row.id,
      skuId: sku.sku.id,
      slug: p.row.slug,
      title: p.row.title,
      brand: p.row.brand.name,
      image: img ? imageSet(img, this.bases) : null,
      rating: p.row.ratingX10 / 10,
      ratingCount: p.row.ratingCount,
      pricing: best ? priceInfo(best.price, best.mrp, p.gstBp) : null,
      inStock: !!best,
      plus: best?.fulfilment === 'SHOPSPHERE',
    };
  }

  offerView(o: OfferRow, gstBp: number): OfferView {
    const stock = stockStatus(o.stockQty - o.reservedQty);
    return {
      id: o.id,
      skuId: o.skuId,
      seller: {
        id: o.seller.id,
        name: o.seller.name,
        rating: o.seller.ratingX10 / 10,
        isFirstParty: o.seller.isFirstParty,
      },
      pricing: priceInfo(o.price, o.mrp, gstBp),
      fulfilment: o.fulfilment === 'SHOPSPHERE' ? 'SHOPSPHERE' : 'SELLER',
      stockStatus: stock.status,
      ...(stock.low !== undefined ? { lowStockQty: stock.low } : {}),
      maxPerOrder: Math.max(1, Math.min(o.maxPerOrder, o.stockQty - o.reservedQty)),
      baseSlaDays: offerBaseSla(o),
    };
  }
}
