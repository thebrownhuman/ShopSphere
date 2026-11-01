import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { CacheService } from './cache/cache.service';
import { ConfigModule } from './config/config.module';
import { ProcessedEventsService } from './events/processed-events.service';
import { SignInHooks } from './events/sign-in-hooks';
import { OutboxPublisher } from './outbox/outbox.publisher';
import { OutboxService } from './outbox/outbox.service';
import { MetricsModule } from './metrics/metrics.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/** Cross-cutting building blocks. Domain modules import from here, never from each other's internals. */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, MetricsModule],
  providers: [
    AuditService,
    CacheService,
    OutboxService,
    OutboxPublisher,
    ProcessedEventsService,
    SignInHooks,
  ],
  exports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    MetricsModule,
    AuditService,
    CacheService,
    OutboxService,
    ProcessedEventsService,
    SignInHooks,
  ],
})
export class SharedModule {}
