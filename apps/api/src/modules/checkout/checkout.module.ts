import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CouponModule } from '../coupon/coupon.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

/** Checkout sessions and place-order (M4.3–M4.9). */
@Module({
  imports: [
    IdentityModule,
    CatalogModule,
    CouponModule,
    LedgerModule,
    InventoryModule,
    OrderModule,
    PaymentModule,
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
