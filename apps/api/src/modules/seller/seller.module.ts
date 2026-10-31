import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { SearchModule } from '../search/search.module';
import { BulkListingService } from './bulk-listing.service';
import { InventoryService } from './inventory.service';
import { ListingService } from './listing.service';
import { PennyDropService } from './penny-drop';
import { SellerAccountService } from './seller-account.service';
import {
  SellerAdminController,
  SellerController,
  SellerMediaController,
} from './seller.controller';

/** Seller Central (M5.1–M5.4, M5.8): onboarding/KYC, listings, bulk upload, inventory, dashboard. */
@Module({
  imports: [IdentityModule, CatalogModule, SearchModule],
  controllers: [SellerMediaController, SellerAdminController, SellerController],
  providers: [
    PennyDropService,
    SellerAccountService,
    ListingService,
    BulkListingService,
    InventoryService,
  ],
  exports: [SellerAccountService],
})
export class SellerModule {}
