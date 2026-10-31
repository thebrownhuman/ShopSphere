import { HttpStatus, Injectable } from '@nestjs/common';
import type { Coupon } from '@prisma/client';
import { AppError } from '../shared/errors/app-error';
import { PrismaService, type Tx } from '../shared/prisma/prisma.service';
import {
  evaluateCoupon,
  normaliseCouponCode,
  type CouponDef,
  type CouponLine,
  type CouponResult,
} from './coupon-engine';

export function toDef(c: Coupon): CouponDef {
  return {
    code: c.code,
    description: c.description,
    type: c.type === 'PERCENT' ? 'PERCENT' : 'FLAT',
    value: Number(c.value),
    minOrderPaise: Number(c.minOrderPaise),
    maxDiscountPaise: c.maxDiscountPaise === null ? null : Number(c.maxDiscountPaise),
    perUserLimit: c.perUserLimit,
    totalLimit: c.totalLimit,
    usedCount: c.usedCount,
    categoryIds: c.categoryIds,
    sellerIds: c.sellerIds,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    active: c.active,
  };
}

/**
 * Coupon persistence around the pure engine. Usage is HELD at place-order (so per-user and total
 * limits hold under concurrency), USED on confirmation and RELEASED on cancel / payment expiry.
 */
@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  async find(code: string, db: Tx = this.prisma): Promise<Coupon | null> {
    return db.coupon.findUnique({ where: { code: normaliseCouponCode(code) } });
  }

  private userRedemptions(db: Tx, couponId: string, userId: string): Promise<number> {
    return db.couponRedemption.count({ where: { couponId, userId, status: { not: 'RELEASED' } } });
  }

  async evaluate(
    code: string,
    userId: string,
    lines: CouponLine[],
    now = new Date(),
  ): Promise<{ coupon: Coupon | null; result: CouponResult }> {
    const coupon = await this.find(code);
    const used = coupon ? await this.userRedemptions(this.prisma, coupon.id, userId) : 0;
    return {
      coupon,
      result: evaluateCoupon(coupon && toDef(coupon), { now, userRedemptions: used, lines }),
    };
  }

  /**
   * Re-validates under locks and holds one use for `orderId`. Serialised per (coupon, user) by an
   * advisory lock; the total limit is enforced by a conditional increment.
   */
  async hold(
    tx: Tx,
    couponId: string,
    userId: string,
    orderId: string,
    lines: CouponLine[],
    expectedDiscount: number,
    now = new Date(),
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`coupon:${couponId}:${userId}`}))`;
    const coupon = await tx.coupon.findUniqueOrThrow({ where: { id: couponId } });
    const used = await this.userRedemptions(tx, couponId, userId);
    const result = evaluateCoupon(toDef(coupon), { now, userRedemptions: used, lines });
    if (!result.ok)
      throw new AppError(result.code, result.message, HttpStatus.UNPROCESSABLE_ENTITY);
    if (result.discountPaise !== expectedDiscount) {
      throw new AppError('PRICE_CHANGED', 'Your coupon discount changed', HttpStatus.CONFLICT);
    }
    const n = await tx.$executeRaw`
      UPDATE coupons SET used_count = used_count + 1
      WHERE id = ${couponId}::uuid AND (total_limit IS NULL OR used_count < total_limit)`;
    if (n === 0) {
      throw new AppError(
        'COUPON_USAGE_LIMIT',
        'This coupon has been fully redeemed',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await tx.couponRedemption.create({
      data: {
        couponId,
        userId,
        orderId,
        amountPaise: BigInt(result.discountPaise),
        status: 'HELD',
      },
    });
  }

  async markUsed(tx: Tx, orderId: string): Promise<void> {
    await tx.couponRedemption.updateMany({
      where: { orderId, status: 'HELD' },
      data: { status: 'USED' },
    });
  }

  /** Gives the use back (cancel / payment expiry). */
  async release(tx: Tx, orderId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ coupon_id: string }[]>`
      UPDATE coupon_redemptions SET status = 'RELEASED', updated_at = now()
      WHERE order_id = ${orderId}::uuid AND status <> 'RELEASED'
      RETURNING coupon_id::text`;
    for (const r of rows) {
      await tx.$executeRaw`UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE id = ${r.coupon_id}::uuid`;
    }
  }

  /** Late capture confirms an order whose hold was released: re-take the use without limits. */
  async reinstate(tx: Tx, orderId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ coupon_id: string }[]>`
      UPDATE coupon_redemptions SET status = 'USED', updated_at = now()
      WHERE order_id = ${orderId}::uuid AND status = 'RELEASED'
      RETURNING coupon_id::text`;
    for (const r of rows) {
      // Honour the redemption even if the cap filled meanwhile; the counter just stays at the cap.
      await tx.$executeRaw`
        UPDATE coupons SET used_count = LEAST(used_count + 1, COALESCE(total_limit, used_count + 1))
        WHERE id = ${r.coupon_id}::uuid`;
    }
  }
}
