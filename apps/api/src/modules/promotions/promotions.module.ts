import { Module } from '@nestjs/common';
import { PromotionsService } from './promotions.service';

/** Lightning deals, bank offers and coupon admin (M6.6). Admin routes live in AdminModule. */
@Module({ providers: [PromotionsService], exports: [PromotionsService] })
export class PromotionsModule {}
