import { Module } from '@nestjs/common';
import { AdminAuditInterceptor, StaffGuard } from '../admin/rbac';
import { IdentityModule } from '../identity/identity.module';
import { OrderModule } from '../order/order.module';
import { FraudAdminController } from './fraud.controller';
import { FraudService } from './fraud.service';

/** Fraud scoring v1 + admin review queue (M7.2). */
@Module({
  imports: [IdentityModule, OrderModule],
  controllers: [FraudAdminController],
  providers: [FraudService, StaffGuard, AdminAuditInterceptor],
  exports: [FraudService],
})
export class FraudModule {}
