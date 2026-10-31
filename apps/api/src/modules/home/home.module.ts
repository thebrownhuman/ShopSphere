import { Controller, Get, Header, Module } from '@nestjs/common';
import type { Request } from 'express';
import type { HomeResponse } from '@shopsphere/types';
import { CatalogModule } from '../catalog/catalog.module';
import { Req, ViewerResolver } from '../catalog/viewer';
import { PromotionsModule } from '../promotions/promotions.module';
import { SearchModule } from '../search/search.module';
import { HomeService } from './home.service';

@Controller('home')
export class HomeController {
  constructor(
    private readonly home: HomeService,
    private readonly viewers: ViewerResolver,
  ) {}

  /** Personalised per viewer, so never shared-cached. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  async get(@Req() req: Request): Promise<HomeResponse> {
    return this.home.home(await this.viewers.resolve(req));
  }
}

@Module({
  imports: [CatalogModule, SearchModule, PromotionsModule],
  controllers: [HomeController],
  providers: [HomeService],
  exports: [HomeService],
})
export class HomeModule {}
