import { ReturnsModule } from '../returns/returns.module';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { SellerModule } from '../seller/seller.module';
import { SettlementModule } from '../settlement/settlement.module';
import { ShippingModule } from '../shipping/shipping.module';
import { SellerOrdersController, ShippingController } from './fulfilment.controller';
import { FulfilmentService } from './fulfilment.service';

/** Seller order queue + courier tracking (M5.5, M5.6). */
@Module({
  imports: [
    IdentityModule,
    SellerModule,
    PaymentModule,
    OrderModule,
    ShippingModule,
    SettlementModule,
    ReturnsModule,
  ],
  controllers: [SellerOrdersController, ShippingController],
  providers: [FulfilmentService],
  exports: [FulfilmentService],
})
export class FulfilmentModule {}
