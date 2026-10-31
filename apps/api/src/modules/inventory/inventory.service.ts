import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../shared/errors/app-error';
import type { Tx } from '../shared/prisma/prisma.service';

export interface ReserveLine {
  offerId: string;
  skuId: string;
  qty: number;
  /** Price the order was quoted at; a different live price aborts the reservation. */
  unitPricePaise?: number;
}

export type ReserveResult =
  | { ok: true }
  | {
      ok: false;
      skuId: string;
      reason: 'OUT_OF_STOCK' | 'UNAVAILABLE' | 'PRICE_CHANGED';
      available: number;
    };

interface LockedOffer {
  id: string;
  sku_id: string;
  stock_qty: number;
  reserved_qty: number;
  price: bigint;
  status: string;
}

/**
 * Stock reservations (M4.1). Invariant: offers.reserved_qty = Σ qty of ACTIVE reservations, and
 * stock_qty ≥ reserved_qty ≥ 0 (CHECK constraint). Every method joins the caller's transaction
 * and locks offer rows in id order, so concurrent checkouts serialise per offer without
 * deadlocks and never oversell: reserving checks and writes under the same row locks.
 */
@Injectable()
export class InventoryService {
  /** Locks the offers, verifies every line, then reserves all of them. Writes nothing on failure. */
  async reserve(
    tx: Tx,
    orderId: string,
    lines: ReserveLine[],
    expiresAt: Date,
  ): Promise<ReserveResult> {
    const merged = mergeLines(lines);
    const ids = [...merged.keys()].sort();
    const rows = await tx.$queryRaw<LockedOffer[]>`
      SELECT o.id::text, o.sku_id::text, o.stock_qty, o.reserved_qty, o.price,
             CASE WHEN o.status = 'ACTIVE' AND s.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
      FROM offers o JOIN sellers s ON s.id = o.seller_id
      WHERE o.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY o.id
      FOR UPDATE OF o`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const want = merged.get(id)!;
      const row = byId.get(id);
      if (!row || row.status !== 'ACTIVE') {
        return { ok: false, skuId: want.skuId, reason: 'UNAVAILABLE', available: 0 };
      }
      const available = row.stock_qty - row.reserved_qty;
      if (available < want.qty) {
        return {
          ok: false,
          skuId: want.skuId,
          reason: 'OUT_OF_STOCK',
          available: Math.max(0, available),
        };
      }
      if (want.unitPricePaise !== undefined && Number(row.price) !== want.unitPricePaise) {
        return { ok: false, skuId: want.skuId, reason: 'PRICE_CHANGED', available };
      }
    }
    for (const id of ids) {
      await tx.$executeRaw`
        UPDATE offers SET reserved_qty = reserved_qty + ${merged.get(id)!.qty}, updated_at = now()
        WHERE id = ${id}::uuid`;
    }
    await tx.inventoryReservation.createMany({
      data: ids.map((id) => ({
        orderId,
        offerId: id,
        skuId: merged.get(id)!.skuId,
        qty: merged.get(id)!.qty,
        expiresAt,
      })),
    });
    return { ok: true };
  }

  /** Like reserve(), but a shortage is a 409 the caller lets roll the transaction back. */
  async reserveOrThrow(
    tx: Tx,
    orderId: string,
    lines: ReserveLine[],
    expiresAt: Date,
  ): Promise<void> {
    const r = await this.reserve(tx, orderId, lines, expiresAt);
    if (r.ok) return;
    if (r.reason === 'PRICE_CHANGED') {
      throw new AppError(
        'PRICE_CHANGED',
        'A price changed while placing your order',
        HttpStatus.CONFLICT,
        { skuId: r.skuId },
      );
    }
    throw new AppError(
      'OUT_OF_STOCK',
      r.reason === 'UNAVAILABLE'
        ? 'An item is no longer available'
        : 'An item just went out of stock',
      HttpStatus.CONFLICT,
      { skuId: r.skuId, available: r.available },
    );
  }

  /** Reservation → hard deduction (order confirmed). Returns units deducted. */
  async consume(tx: Tx, orderId: string): Promise<number> {
    return this.settle(
      tx,
      orderId,
      'CONSUMED',
      Prisma.sql`stock_qty = stock_qty - r.qty, reserved_qty = reserved_qty - r.qty`,
    );
  }

  /** Drops an unpaid hold (payment window closed, or cancelled before payment). */
  async release(tx: Tx, orderId: string): Promise<number> {
    return this.settle(tx, orderId, 'RELEASED', Prisma.sql`reserved_qty = reserved_qty - r.qty`);
  }

  /** Puts deducted stock back (confirmed order cancelled before shipping). */
  async restock(tx: Tx, orderId: string): Promise<number> {
    const rows = await tx.$queryRaw<{ offer_id: string; qty: number }[]>`
      UPDATE inventory_reservations SET status = 'RESTOCKED', updated_at = now()
      WHERE order_id = ${orderId}::uuid AND status = 'CONSUMED'
      RETURNING offer_id::text, qty`;
    for (const r of rows.sort((a, b) => a.offer_id.localeCompare(b.offer_id))) {
      await tx.$executeRaw`UPDATE offers SET stock_qty = stock_qty + ${r.qty}, updated_at = now() WHERE id = ${r.offer_id}::uuid`;
    }
    return rows.reduce((s, r) => s + r.qty, 0);
  }

  async extend(tx: Tx, orderId: string, until: Date): Promise<void> {
    await tx.inventoryReservation.updateMany({
      where: { orderId, status: 'ACTIVE', expiresAt: { lt: until } },
      data: { expiresAt: until },
    });
  }

  private async settle(
    tx: Tx,
    orderId: string,
    to: 'CONSUMED' | 'RELEASED',
    set: Prisma.Sql,
  ): Promise<number> {
    // Lock the reservation rows first, then the offers in id order (same order as reserve()).
    const held = await tx.$queryRaw<{ id: string; offer_id: string; qty: number }[]>`
      SELECT id::text, offer_id::text, qty FROM inventory_reservations
      WHERE order_id = ${orderId}::uuid AND status = 'ACTIVE'
      ORDER BY offer_id FOR UPDATE`;
    if (held.length === 0) return 0;
    const offerIds = [...new Set(held.map((h) => h.offer_id))].sort();
    await tx.$queryRaw`
      SELECT id FROM offers WHERE id IN (${Prisma.join(offerIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE`;
    await tx.$executeRaw`
      UPDATE offers o SET ${set}, updated_at = now()
      FROM (SELECT offer_id, SUM(qty)::int AS qty FROM inventory_reservations
            WHERE id IN (${Prisma.join(held.map((h) => Prisma.sql`${h.id}::uuid`))})
            GROUP BY offer_id) r
      WHERE o.id = r.offer_id`;
    await tx.$executeRaw`
      UPDATE inventory_reservations SET status = ${to}, updated_at = now()
      WHERE id IN (${Prisma.join(held.map((h) => Prisma.sql`${h.id}::uuid`))})`;
    return held.reduce((s, h) => s + h.qty, 0);
  }
}

function mergeLines(lines: ReserveLine[]): Map<string, ReserveLine> {
  const out = new Map<string, ReserveLine>();
  for (const l of lines) {
    const prev = out.get(l.offerId);
    out.set(l.offerId, prev ? { ...prev, qty: prev.qty + l.qty } : { ...l });
  }
  return out;
}
