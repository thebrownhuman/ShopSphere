import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { SellerModule } from '../seller/seller.module';
import { SellerGuard } from '../fulfilment/seller.guard';
import {
  ProductQuestionsController,
  QuestionAnswersController,
  SellerQuestionsController,
} from './qa.controller';
import { QaService } from './qa.service';

/** Customer Q&A (M6.3). */
@Module({
  imports: [IdentityModule, SellerModule],
  controllers: [ProductQuestionsController, QuestionAnswersController, SellerQuestionsController],
  providers: [QaService, SellerGuard],
})
export class QaModule {}
