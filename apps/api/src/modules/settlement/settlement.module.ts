import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PaymentModule } from '../payment/payment.module';
import { SellerModule } from '../seller/seller.module';
import { BankPayoutClient } from './bank-payout.client';
import { SellerPayoutsController, SettlementInternalController } from './settlement.controller';
import { loadSettlementConfig, SETTLEMENT_CONFIG } from './settlement.config';
import { SettlementService } from './settlement.service';

/** Settlement engine + payouts (M5.7). Lines are written by fulfilment on delivery. */
@Module({
  imports: [IdentityModule, SellerModule, PaymentModule],
  controllers: [SellerPayoutsController, SettlementInternalController],
  providers: [
    { provide: SETTLEMENT_CONFIG, useFactory: () => loadSettlementConfig(process.env) },
    BankPayoutClient,
    SettlementService,
  ],
  exports: [SettlementService],
})
export class SettlementModule {}
