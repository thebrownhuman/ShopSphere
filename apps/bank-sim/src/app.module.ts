import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { BankErrorFilter, MerchantApiController } from './api.controller';
import { BankService } from './bank.service';
import { CheckoutController } from './checkout.controller';

@Module({
  controllers: [MerchantApiController, CheckoutController],
  providers: [BankService, { provide: APP_FILTER, useClass: BankErrorFilter }],
})
export class AppModule {}
