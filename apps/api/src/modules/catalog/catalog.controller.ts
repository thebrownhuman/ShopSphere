import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  CategoriesResponse,
  ProductDetailResponse,
  ProductOffersResponse,
  RecentlyViewedResponse,
} from '@shopsphere/types';
import { z } from 'zod';
import { AppError } from '../shared/errors/app-error';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { CacheService } from '../shared/cache/cache.service';
import { CatalogService } from './catalog.service';
import { CategoryTreeService } from './category-tree.service';
import { DiscoveryService } from './discovery.service';
import { placeholderSvg } from './media';
import { Req, ViewerResolver } from './viewer';

const recordViewBody = z.object({ productId: z.string().uuid() });

@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly categories: CategoryTreeService,
    private readonly discovery: DiscoveryService,
    private readonly viewers: ViewerResolver,
    private readonly cache: CacheService,
  ) {}

  @Get('categories')
  @Header('Cache-Control', 'public, max-age=300')
  async categoryTree(): Promise<CategoriesResponse> {
    return { categories: await this.categories.tree() };
  }

  /** Product content. Price/stock inside are live; clients must not cache for more than 60 s. */
  @Get('products/:slug')
  @Header('Cache-Control', 'public, max-age=60')
  product(@Param('slug') slug: string, @Query('sku') sku?: string): Promise<ProductDetailResponse> {
    // Within the 60 s the response already allows clients to cache; offers stay live at /offers
    // and checkout re-prices everything (M7.5).
    return this.cache.getOrSet('pdp', `${slug}:${sku ?? ''}`, 15, () =>
      this.catalog.productBySlug(slug, sku),
    );
  }

  @Get('products/:id/offers')
  @Header('Cache-Control', 'no-store')
  offers(@Param('id') id: string, @Query('sku') sku?: string): Promise<ProductOffersResponse> {
    return this.catalog.offers(id, sku);
  }

  @Get('recently-viewed')
  @Header('Cache-Control', 'private, no-store')
  async recentlyViewed(@Req() req: Request): Promise<RecentlyViewedResponse> {
    const viewer = await this.viewers.resolve(req);
    return { products: await this.discovery.recentlyViewed(viewer.ownerKey) };
  }

  @Post('recently-viewed')
  @HttpCode(HttpStatus.NO_CONTENT)
  async recordView(@Req() req: Request, @Body() body: unknown): Promise<void> {
    const parsed = recordViewBody.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', 'productId must be a UUID', 400, parsed.error.issues);
    }
    const viewer = await this.viewers.resolve(req);
    if (!viewer.ownerKey)
      throw new AppError('GUEST_ID_REQUIRED', 'Send X-Guest-Id or sign in', 400);
    await this.discovery.recordView(viewer.ownerKey, parsed.data.productId);
  }

  /** Generated placeholder artwork for seed products (M2.24). */
  @Get('media/ph/:seed')
  @SkipRateLimit()
  placeholder(
    @Param('seed') seed: string,
    @Query('label') label: string | undefined,
    @Query('color') color: string | undefined,
    @Query('w') w: string | undefined,
    @Res() res: Response,
  ): void {
    res
      .type('image/svg+xml')
      .set('Cache-Control', 'public, max-age=31536000, immutable')
      .send(
        placeholderSvg(
          seed.replace(/\.svg$/, ''),
          (label ?? 'ShopSphere').slice(0, 80),
          Number(w),
          color,
        ),
      );
  }
}
