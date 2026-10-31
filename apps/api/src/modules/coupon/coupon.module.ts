import { Module } from '@nestjs/common';
import { CouponService } from './coupon.service';

/** Coupon engine v1 (M4.6). */
@Module({ providers: [CouponService], exports: [CouponService] })
export class CouponModule {}
