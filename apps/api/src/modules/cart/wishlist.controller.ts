import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { CartResponse, WishlistResponse } from '@shopsphere/types';
import { z } from 'zod';
import { ProductLoader } from '../catalog/product-loader';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { DEFAULT_PINCODE } from './cart.controller';
import { JsonWritesGuard } from './cart-owner';
import { CartService } from './cart.service';

const addSchema = z.object({ sku: z.string().uuid() });
const notFound = () => new AppError('NOT_FOUND', 'That item is not in your wishlist', 404);

/** Wishlist (M3.6): signed-in shoppers only, one list per user. */
@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductLoader,
  ) {}

  private async wishlistId(userId: string): Promise<string> {
    const w = await this.prisma.wishlist.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    return w.id;
  }

  async list(userId: string): Promise<WishlistResponse> {
    const rows = await this.prisma.wishlistItem.findMany({
      where: { wishlist: { userId } },
      orderBy: { addedAt: 'desc' },
    });
    const loaded = await this.products.loadMany([...new Set(rows.map((r) => r.productId))]);
    const byId = new Map(loaded.map((p) => [p.row.id, p]));
    return {
      items: rows.map((r) => {
        const p = byId.get(r.productId);
        const sku = p?.skus.find((s) => s.sku.id === r.skuId);
        const best = sku?.ranked[0];
        const card = p ? this.products.card({ ...p, defaultSku: sku ?? p.defaultSku }) : null;
        return {
          id: r.id,
          productId: r.productId,
          skuId: r.skuId,
          slug: p?.row.slug ?? '',
          title: p?.row.title ?? 'This item is no longer available',
          image: card?.image ?? null,
          price: best ? Number(best.price) : null,
          mrp: best ? Number(best.mrp > best.price ? best.mrp : best.price) : null,
          inStock: !!best,
          addedAt: r.addedAt.toISOString(),
        };
      }),
    };
  }

  async add(userId: string, skuId: string): Promise<void> {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      select: { productId: true, product: { select: { status: true } } },
    });
    if (!sku || sku.product.status !== 'ACTIVE') {
      throw new AppError('SKU_UNAVAILABLE', 'This item is no longer available', 422);
    }
    const wishlistId = await this.wishlistId(userId);
    await this.prisma.wishlistItem.upsert({
      where: { wishlistId_skuId: { wishlistId, skuId } },
      create: { wishlistId, skuId, productId: sku.productId },
      update: {},
    });
  }

  async remove(userId: string, id: string): Promise<{ skuId: string } | null> {
    const item = await this.prisma.wishlistItem.findFirst({
      where: { id, wishlist: { userId } },
      select: { id: true, skuId: true },
    });
    if (!item) return null;
    await this.prisma.wishlistItem.deleteMany({ where: { id: item.id } });
    return item;
  }

  async find(userId: string, id: string) {
    return this.prisma.wishlistItem.findFirst({ where: { id, wishlist: { userId } } });
  }
}

@Controller('wishlist')
@UseGuards(AccessTokenGuard, JsonWritesGuard)
export class WishlistController {
  constructor(
    private readonly wishlist: WishlistService,
    private readonly cart: CartService,
  ) {}

  private id(id: string): string {
    if (!z.string().uuid().safeParse(id).success) throw notFound();
    return id;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Auth() auth: AccessClaims): Promise<WishlistResponse> {
    return this.wishlist.list(auth.sub);
  }

  @Post('items')
  @HttpCode(201)
  async add(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<WishlistResponse> {
    await this.wishlist.add(auth.sub, addSchema.parse(body).sku);
    return this.wishlist.list(auth.sub);
  }

  @Delete('items/:id')
  async remove(@Auth() auth: AccessClaims, @Param('id') id: string): Promise<WishlistResponse> {
    await this.wishlist.remove(auth.sub, this.id(id));
    return this.wishlist.list(auth.sub);
  }

  /** Adds one unit (buy-box seller) to the cart, then drops it from the wishlist. */
  @Post('items/:id/move-to-cart')
  @HttpCode(200)
  async moveToCart(
    @Auth() auth: AccessClaims,
    @Param('id') id: string,
    @Query('pincode') pincode?: string,
  ): Promise<CartResponse> {
    const item = await this.wishlist.find(auth.sub, this.id(id));
    if (!item) throw notFound();
    const pin = (pincode || DEFAULT_PINCODE).trim();
    const r = await this.cart.addItem({ userId: auth.sub }, { sku: item.skuId, qty: 1 }, pin);
    await this.wishlist.remove(auth.sub, item.id);
    return this.cart.view(r.cartId, pin);
  }
}
