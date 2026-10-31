import { Module } from '@nestjs/common';
import { PAYABLE_ORDER_SOURCE, StubOrderSource } from './orders/payable-order-source';
import {
  InternalTokenGuard,
  PaymentController,
  PaymentWebhookController,
} from './payment.controller';
import { loadPaymentConfig, PAYMENT_CONFIG } from './payment.config';
import { PaymentService } from './payment.service';
import { ProviderRegistry } from './providers/provider.registry';
import { PAYMENT_REPOSITORY } from './repository/payment.repository';
import { PrismaPaymentRepository } from './repository/prisma-payment.repository';

@Module({
  controllers: [PaymentController, PaymentWebhookController],
  providers: [
    { provide: PAYMENT_CONFIG, useFactory: () => loadPaymentConfig(process.env) },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    // Swap for the orders module's implementation in M4.
    { provide: PAYABLE_ORDER_SOURCE, useClass: StubOrderSource },
    ProviderRegistry,
    PaymentService,
    InternalTokenGuard,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
