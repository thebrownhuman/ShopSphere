import { Module } from '@nestjs/common';
import { CouponModule } from '../coupon/coupon.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PaymentModule } from '../payment/payment.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { InvoiceStore, S3InvoiceStore } from './invoice.store';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderWorker } from './order.worker';
import { PaymentEventsConsumer } from './payment-events.consumer';

/** Orders: state machine, payment outcomes, expiry, cancel/refund (M4.15–M4.17, M4.27–M4.29, M4.34–M4.36). */
@Module({
  imports: [
    IdentityModule,
    PaymentModule,
    InventoryModule,
    LedgerModule,
    CouponModule,
    PromotionsModule,
  ],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderWorker,
    PaymentEventsConsumer,
    { provide: InvoiceStore, useClass: S3InvoiceStore },
  ],
  exports: [OrderService],
})
export class OrderModule {}
