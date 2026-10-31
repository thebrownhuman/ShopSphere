import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InventoryPage, InventoryRow, OfferPatch, SellerDashboard } from '@shopsphere/types';
import { offerChanged } from '../catalog/catalog-events';
import { AppError } from '../shared/errors/app-error';
import { OutboxService } from '../shared/outbox/outbox.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { MAX_STOCK } from './listing.service';

const OFFER_INCLUDE = { sku: { include: { product: true } } } satisfies Prisma.OfferInclude;
type OfferRow = Prisma.OfferGetPayload<{ include: typeof OFFER_INCLUDE }>;

/** Statuses counted as sales (paid or COD-confirmed and not cancelled). */
const SOLD = [
  'CONFIRMED',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RETURN_REQUESTED',
  'PICKED_UP',
  'REFUNDED',
];

/** Inventory & price table (M5.4) and the read-only seller dashboard (M5.8). */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    sellerId: string,
    opts: { q?: string; cursor?: string; limit?: number },
  ): Promise<InventoryPage> {
    const limit = opts.limit ?? 50;
    const q = opts.q?.trim();
    const rows = await this.prisma.offer.findMany({
      where: {
        sellerId,
        ...(q
          ? {
              OR: [
                { sku: { code: { contains: q, mode: 'insensitive' } } },
                { sku: { product: { title: { contains: q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: OFFER_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      rows: page.map(toRow),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** Inline edit. Stock may not drop below units reserved by open checkouts. */
  async patch(sellerId: string, offerId: string, p: OfferPatch): Promise<InventoryRow> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM offers WHERE id = ${offerId}::uuid AND seller_id = ${sellerId}::uuid FOR UPDATE`;
      if (!locked) throw new AppError('OFFER_NOT_FOUND', 'Listing not found', 404);
      const cur = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
      const price = p.price ?? Number(cur.price);
      const mrp = p.mrp ?? Number(cur.mrp);
      const stock = p.stock ?? cur.stockQty;
      const issues: { field: string; message: string }[] = [];
      if (!Number.isSafeInteger(price) || price <= 0)
        issues.push({ field: 'price', message: 'Price must be positive' });
      if (!Number.isSafeInteger(mrp) || mrp < price)
        issues.push({ field: 'mrp', message: 'MRP cannot be below the price' });
      if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) {
        issues.push({ field: 'stock', message: `Stock must be 0-${MAX_STOCK}` });
      } else if (stock < cur.reservedQty) {
        issues.push({
          field: 'stock',
          message: `${cur.reservedQty} units are reserved by open orders`,
        });
      }
      if (issues.length) throw new AppError('OFFER_INVALID', issues[0].message, 422, issues);
      const updated = await tx.offer.update({
        where: { id: offerId },
        data: {
          price: BigInt(price),
          mrp: BigInt(mrp),
          stockQty: stock,
          ...(p.status ? { status: p.status } : {}),
        },
        include: OFFER_INCLUDE,
      });
      const stockOnly = p.price === undefined && p.mrp === undefined && p.status === undefined;
      await offerChanged(this.outbox, tx, {
        offerId,
        skuId: updated.skuId,
        productId: updated.sku.productId,
        stockOnly,
      });
      return toRow(updated);
    });
  }

  async dashboard(sellerId: string, now = new Date()): Promise<SellerDashboard> {
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const [daily, byStatus, listings, payouts] = await Promise.all([
      this.prisma.$queryRaw<{ day: Date; sales: bigint; units: bigint; orders: bigint }[]>`
        SELECT date_trunc('day', o.placed_at) AS day,
               COALESCE(SUM(i.line_total_paise - i.discount_paise), 0)::bigint AS sales,
               COALESCE(SUM(i.qty), 0)::bigint AS units,
               COUNT(DISTINCT o.id)::bigint AS orders
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE i.seller_id = ${sellerId}::uuid AND o.placed_at >= ${since}
          AND o.status = ANY(${SOLD})
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ status: string; n: bigint }[]>`
        SELECT o.status, COUNT(DISTINCT o.id)::bigint AS n
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE i.seller_id = ${sellerId}::uuid
        GROUP BY o.status`,
      this.prisma.$queryRaw<{ active: bigint; oos: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE')::bigint AS active,
               COUNT(*) FILTER (WHERE status = 'ACTIVE' AND stock_qty - reserved_qty <= 0)::bigint AS oos
        FROM offers WHERE seller_id = ${sellerId}::uuid`,
      this.prisma.$queryRaw<{ pending: bigint; paid: bigint; last: Date | null }[]>`
        SELECT
          (SELECT COALESCE(SUM(net_paise), 0) FROM settlement_lines
            WHERE seller_id = ${sellerId}::uuid AND status IN ('PENDING', 'IN_PAYOUT', 'ON_HOLD'))::bigint AS pending,
          (SELECT COALESCE(SUM(amount_paise), 0) FROM seller_payouts
            WHERE seller_id = ${sellerId}::uuid AND status = 'PAID')::bigint AS paid,
          (SELECT MAX(paid_at) FROM seller_payouts
            WHERE seller_id = ${sellerId}::uuid AND status = 'PAID') AS last`,
    ]);
    const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
    const today = daily.find((d) => d.day.getTime() === dayStart.getTime());
    return {
      sales: {
        last30DaysPaise: daily.reduce((s, d) => s + Number(d.sales), 0),
        unitsLast30Days: daily.reduce((s, d) => s + Number(d.units), 0),
        todayPaise: today ? Number(today.sales) : 0,
      },
      orders: { total: Object.values(statusMap).reduce((a, b) => a + b, 0), byStatus: statusMap },
      returns: {
        requested: (statusMap.RETURN_REQUESTED ?? 0) + (statusMap.PICKED_UP ?? 0),
        completed: statusMap.REFUNDED ?? 0,
      },
      listings: {
        activeOffers: Number(listings[0]?.active ?? 0),
        outOfStock: Number(listings[0]?.oos ?? 0),
      },
      // From the settlement engine (M5.7, fulfilment module): delivered-but-unpaid net vs paid out.
      payouts: {
        pendingPaise: Number(payouts[0]?.pending ?? 0),
        paidPaise: Number(payouts[0]?.paid ?? 0),
        lastPayoutAt: payouts[0]?.last?.toISOString() ?? null,
      },
      daily: daily.map((d) => ({
        date: d.day.toISOString().slice(0, 10),
        salesPaise: Number(d.sales),
        orders: Number(d.orders),
      })),
    };
  }
}

function toRow(o: OfferRow): InventoryRow {
  return {
    offerId: o.id,
    skuId: o.skuId,
    skuCode: o.sku.code,
    productId: o.sku.productId,
    productSlug: o.sku.product.slug,
    title: o.sku.product.title,
    attributes: o.sku.attributes as Record<string, string>,
    price: Number(o.price),
    mrp: Number(o.mrp),
    stock: o.stockQty,
    reserved: o.reservedQty,
    status: o.status as InventoryRow['status'],
    updatedAt: o.updatedAt.toISOString(),
  };
}
