import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SearchResponse, SuggestResponse } from '@shopsphere/types';
import { z, ZodError } from 'zod';
import { CatalogInternalGuard } from '../catalog/catalog.config';
import { Req, ViewerResolver } from '../catalog/viewer';
import { AppError } from '../shared/errors/app-error';
import { SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { parseSearchParams } from './search-query';
import { SearchIndexerService } from './search-indexer.service';
import { SearchService } from './search.service';

const clickBody = z.object({
  searchId: z.string().uuid(),
  productId: z.string().uuid(),
  position: z.number().int().min(0).max(10_000),
});

@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly viewers: ViewerResolver,
  ) {}

  @Get()
  async query(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<SearchResponse> {
    let params;
    try {
      params = parseSearchParams(query);
    } catch (err) {
      if (err instanceof ZodError)
        throw new AppError('VALIDATION_FAILED', 'Invalid search parameters', 400, err.issues);
      throw err;
    }
    const viewer = await this.viewers.resolve(req);
    return this.search.search(params, viewer.ownerKey);
  }

  @Get('suggest')
  suggest(@Query('q') q = ''): Promise<SuggestResponse> {
    return this.search.suggest(String(q));
  }

  @Post('click')
  @HttpCode(HttpStatus.NO_CONTENT)
  async click(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const parsed = clickBody.safeParse(body);
    if (!parsed.success)
      throw new AppError('VALIDATION_FAILED', 'Invalid click event', 400, parsed.error.issues);
    const viewer = await this.viewers.resolve(req);
    await this.search.recordClick(parsed.data, viewer.ownerKey);
  }
}

/** Worker-only indexer triggers. */
@Controller('search/internal')
@UseGuards(CatalogInternalGuard)
@SkipRateLimit()
export class SearchInternalController {
  constructor(private readonly indexer: SearchIndexerService) {}

  @Post('index')
  @HttpCode(HttpStatus.OK)
  index() {
    return this.indexer.processPending();
  }

  @Post('reindex-all')
  @HttpCode(HttpStatus.OK)
  reindexAll() {
    return this.indexer.reindexAll();
  }
}
