import { Module } from '@nestjs/common';
import { DeliveryController, DeliveryService } from '../delivery/delivery.controller';
import { IdentityModule } from '../identity/identity.module';
import { ShippingModule } from '../shipping/shipping.module';
import { CatalogInternalController } from './catalog-internal.controller';
import { CATALOG_CONFIG, CatalogInternalGuard, loadCatalogConfig } from './catalog.config';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { CategoryTreeService } from './category-tree.service';
import { DiscoveryService } from './discovery.service';
import { ProductLoader } from './product-loader';
import { ViewerResolver } from './viewer';

/** Catalog (M2.1–M2.2), pricing/buy-box view, delivery estimate (M2.7), recently viewed (M2.21). */
@Module({
  imports: [IdentityModule, ShippingModule],
  controllers: [CatalogController, CatalogInternalController, DeliveryController],
  providers: [
    { provide: CATALOG_CONFIG, useFactory: () => loadCatalogConfig(process.env) },
    CatalogInternalGuard,
    CategoryTreeService,
    ProductLoader,
    DiscoveryService,
    CatalogService,
    DeliveryService,
    ViewerResolver,
  ],
  exports: [
    CATALOG_CONFIG,
    CatalogInternalGuard,
    CategoryTreeService,
    ProductLoader,
    DiscoveryService,
    ViewerResolver,
  ],
})
export class CatalogModule {}
