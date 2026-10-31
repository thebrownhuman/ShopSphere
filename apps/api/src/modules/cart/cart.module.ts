import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { CART_CONFIG, loadCartConfig } from './cart.config';
import { CartController } from './cart.controller';
import { CartOwnerResolver, JsonWritesGuard } from './cart-owner';
import { CartService } from './cart.service';
import { WishlistController, WishlistService } from './wishlist.controller';

/** Cart, save for later and wishlist (M3). Reads catalog through ProductLoader. */
@Module({
  imports: [IdentityModule, CatalogModule],
  controllers: [CartController, WishlistController],
  providers: [
    { provide: CART_CONFIG, useFactory: () => loadCartConfig(process.env) },
    CartService,
    CartOwnerResolver,
    JsonWritesGuard,
    WishlistService,
  ],
  exports: [CartService],
})
export class CartModule {}
