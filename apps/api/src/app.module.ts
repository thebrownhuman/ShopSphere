import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { GlobalExceptionFilter } from './modules/shared/errors/global-exception.filter';
import { IdempotencyInterceptor } from './modules/shared/idempotency/idempotency.interceptor';
import { RateLimitGuard } from './modules/shared/rate-limit/rate-limit.guard';
import { RequestIdMiddleware } from './modules/shared/request-id/request-id.middleware';
import { SharedModule } from './modules/shared/shared.module';

@Module({
  imports: [SharedModule, HealthModule, IdentityModule],
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
