import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';
import { SellerModule } from '../seller/seller.module';
import { ShippingModule } from '../shipping/shipping.module';
import { ReturnsController, SellerReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

/** Returns (M6.1): eligibility, reverse pickup via the courier adapter, QC and refund on receipt. */
@Module({
  imports: [
    IdentityModule,
    SellerModule,
    OrderModule,
    PaymentModule,
    InventoryModule,
    LedgerModule,
    ShippingModule,
  ],
  controllers: [ReturnsController, SellerReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
