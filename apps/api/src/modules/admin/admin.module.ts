import { Module } from '@nestjs/common';
import { HomeModule } from '../home/home.module';
import { IdentityModule } from '../identity/identity.module';
import { PaymentModule } from '../payment/payment.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SearchModule } from '../search/search.module';
import { SellerModule } from '../seller/seller.module';
import { ADMIN_CONTROLLERS } from './admin.controller';
import { AdminService } from './admin.service';
import { HomeCmsService } from './home-cms.service';
import { AdminAuditInterceptor, StaffGuard } from './rbac';

/** Admin console API (M6.5–M6.7): staff RBAC, moderation, refunds, promotions, home CMS. */
@Module({
  imports: [
    IdentityModule,
    PaymentModule,
    SearchModule,
    SellerModule,
    PromotionsModule,
    HomeModule,
  ],
  controllers: ADMIN_CONTROLLERS,
  providers: [AdminService, HomeCmsService, StaffGuard, AdminAuditInterceptor],
})
export class AdminModule {}
