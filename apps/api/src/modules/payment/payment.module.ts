import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrderPayableSource } from '../order/order-payable.source';
import { DevAwareOrderSource } from './orders/dev-aware-order-source';
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
  imports: [IdentityModule],
  controllers: [PaymentController, PaymentWebhookController],
  providers: [
    { provide: PAYMENT_CONFIG, useFactory: () => loadPaymentConfig(process.env) },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
    OrderPayableSource,
    StubOrderSource,
    { provide: PAYABLE_ORDER_SOURCE, useClass: DevAwareOrderSource },
    ProviderRegistry,
    PaymentService,
    InternalTokenGuard,
  ],
  exports: [PaymentService, ProviderRegistry, PAYMENT_CONFIG],
})
export class PaymentModule {}
