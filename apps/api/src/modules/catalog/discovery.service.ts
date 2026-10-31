import { Injectable } from '@nestjs/common';
import type { ProductCard } from '@shopsphere/types';
import { PrismaService } from '../shared/prisma/prisma.service';
import { ProductLoader } from './product-loader';

export const RECENTLY_VIEWED_MAX = 20;
/** A new view pairs with this many of the owner's previous views for co-view counts. */
const CO_VIEW_WINDOW = 10;

/** Recently viewed + "customers also viewed" (M2.21, simple v1). */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductLoader,
  ) {}

  async recordView(ownerKey: string, productId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.recentlyViewed.findMany({
        where: { ownerKey, productId: { not: productId } },
        orderBy: { viewedAt: 'desc' },
        take: CO_VIEW_WINDOW,
        select: { productId: true },
      });
      const inserted = await tx.$executeRaw`
        INSERT INTO recently_viewed (owner_key, product_id, viewed_at)
        VALUES (${ownerKey}, ${productId}::uuid, now())
        ON CONFLICT (owner_key, product_id) DO NOTHING`;
      if (inserted === 0) {
        await tx.recentlyViewed.update({
          where: { ownerKey_productId: { ownerKey, productId } },
          data: { viewedAt: new Date() },
        });
      } else if (previous.length > 0) {
        // Count each pair once per owner: only a first view of a product adds co-views.
        const others = previous.map((p) => p.productId);
        await tx.$executeRaw`
          INSERT INTO co_views (product_id, other_id, count)
          SELECT a, b, 1 FROM (
            SELECT ${productId}::uuid AS a, o::uuid AS b FROM unnest(${others}::text[]) o
            UNION ALL
            SELECT o::uuid, ${productId}::uuid FROM unnest(${others}::text[]) o
          ) pairs
          ON CONFLICT (product_id, other_id) DO UPDATE SET count = co_views.count + 1`;
      }
      await tx.$executeRaw`
        DELETE FROM recently_viewed WHERE owner_key = ${ownerKey} AND product_id NOT IN (
          SELECT product_id FROM recently_viewed WHERE owner_key = ${ownerKey}
          ORDER BY viewed_at DESC LIMIT ${RECENTLY_VIEWED_MAX})`;
    });
  }

  async recentlyViewed(
    ownerKey: string | null,
    limit = RECENTLY_VIEWED_MAX,
  ): Promise<ProductCard[]> {
    if (!ownerKey) return [];
    const rows = await this.prisma.recentlyViewed.findMany({
      where: { ownerKey },
      orderBy: { viewedAt: 'desc' },
      take: limit,
      select: { productId: true },
    });
    return this.products.cards(rows.map((r) => r.productId));
  }

  async alsoViewedIds(productId: string, limit = 12): Promise<string[]> {
    const rows = await this.prisma.coView.findMany({
      where: { productId },
      orderBy: { count: 'desc' },
      take: limit,
      select: { otherId: true },
    });
    return rows.map((r) => r.otherId);
  }
}
