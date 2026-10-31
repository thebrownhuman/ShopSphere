import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { HomeModule } from './modules/home/home.module';
import { IdentityModule } from './modules/identity/identity.module';
import { NotificationModule } from './modules/notification/notification.module';
import { PaymentModule } from './modules/payment/payment.module';
import { GlobalExceptionFilter } from './modules/shared/errors/global-exception.filter';
import { IdempotencyInterceptor } from './modules/shared/idempotency/idempotency.interceptor';
import { RateLimitGuard } from './modules/shared/rate-limit/rate-limit.guard';
import { SearchModule } from './modules/search/search.module';
import { RequestIdMiddleware } from './modules/shared/request-id/request-id.middleware';
import { SharedModule } from './modules/shared/shared.module';

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
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
