import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AdminModule } from './modules/admin/admin.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { FulfilmentModule } from './modules/fulfilment/fulfilment.module';
import { HealthModule } from './modules/health/health.module';
import { HomeModule } from './modules/home/home.module';
import { IdentityModule } from './modules/identity/identity.module';
import { NotificationModule } from './modules/notification/notification.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { OrderModule } from './modules/order/order.module';
import { PaymentModule } from './modules/payment/payment.module';
import { GlobalExceptionFilter } from './modules/shared/errors/global-exception.filter';
import { IdempotencyInterceptor } from './modules/shared/idempotency/idempotency.interceptor';
import { RateLimitGuard } from './modules/shared/rate-limit/rate-limit.guard';
import { ReturnsModule } from './modules/returns/returns.module';
import { SearchModule } from './modules/search/search.module';
import { SellerModule } from './modules/seller/seller.module';
import { QaModule } from './modules/qa/qa.module';
import { ReviewModule } from './modules/review/review.module';
import { HttpMetricsMiddleware } from './modules/shared/metrics/metrics.module';
import { RequestIdMiddleware } from './modules/shared/request-id/request-id.middleware';
import { SharedModule } from './modules/shared/shared.module';
import { SupportModule } from './modules/support/support.module';

@Module({
  imports: [
    SharedModule,
    HealthModule,
    IdentityModule,
    PaymentModule,
    CatalogModule,
    SearchModule,
    HomeModule,
    CartModule,
    NotificationModule,
    LedgerModule,
    OrderModule,
    CheckoutModule,
    SellerModule,
    FulfilmentModule,
    ReviewModule,
    QaModule,
    ReturnsModule,
    SupportModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, HttpMetricsMiddleware).forRoutes('*');
  }
}
