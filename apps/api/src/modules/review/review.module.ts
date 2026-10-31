import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { SearchModule } from '../search/search.module';
import {
  AdminReviewsController,
  ProductReviewsController,
  ReviewActionsController,
  ReviewInternalController,
} from './review.controller';
import { ReviewMediaStore, S3ReviewMediaStore } from './review-media.store';
import { ReviewService } from './review.service';

/** Reviews (M6.2) and the review summary cache (M6.4). */
@Module({
  imports: [IdentityModule, CatalogModule, SearchModule],
  controllers: [
    ReviewInternalController,
    AdminReviewsController,
    ProductReviewsController,
    ReviewActionsController,
  ],
  providers: [ReviewService, { provide: ReviewMediaStore, useClass: S3ReviewMediaStore }],
  exports: [ReviewService],
})
export class ReviewModule {}
