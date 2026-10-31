import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { ConfigModule } from './config/config.module';
import { ProcessedEventsService } from './events/processed-events.service';
import { OutboxPublisher } from './outbox/outbox.publisher';
import { OutboxService } from './outbox/outbox.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

/** Cross-cutting building blocks. Domain modules import from here, never from each other's internals. */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule, RedisModule],
  providers: [AuditService, OutboxService, OutboxPublisher, ProcessedEventsService],
  exports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    AuditService,
    OutboxService,
    ProcessedEventsService,
  ],
})
export class SharedModule {}
