import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AdminReviewPage,
  AdminReviewView,
  AggregateRunSummary,
  ReviewEligibility,
  ReviewMediaUploadResponse,
  ReviewPage,
  ReviewStats,
  ReviewView,
  ReviewVoteResponse,
  SummaryCandidate,
} from '@shopsphere/types';
import { json } from 'body-parser';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { CatalogInternalGuard } from '../catalog/catalog.config';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { RateLimit, SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { ReviewService } from './review.service';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();
const listSchema = z.object({
  stars: z
    .string()
    .transform((s) => s.split(',').filter(Boolean).map(Number))
    .pipe(z.array(z.number().int().min(1).max(5)))
    .optional(),
  verified: bool,
  withImages: bool,
  sort: z.enum(['helpful', 'recent', 'rating_desc', 'rating_asc']).optional(),
  cursor: z.string().max(12).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
const createSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(5000),
  imageIds: z.array(z.string().uuid()).max(5).optional(),
});
const mediaSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  dataBase64: z.string().min(4),
});
const reportSchema = z.object({
  reason: z.enum(['SPAM', 'OFFENSIVE', 'IRRELEVANT', 'FAKE', 'OTHER']),
  note: z.string().trim().max(500).optional(),
});
const adminListSchema = z.object({
  status: z.enum(['PENDING', 'PUBLISHED', 'REJECTED']).optional(),
  reported: bool,
  cursor: z.string().max(12).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const moderateSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
});
const themeSchema = z.object({
  label: z.string().min(1).max(60),
  sentiment: z.enum(['positive', 'negative', 'mixed']),
  mentions: z.number().int().min(0),
});
const summarySchema = z.object({
  summary: z.string().min(1).max(2000),
  themes: z.array(themeSchema).max(12),
  source: z.enum(['claude', 'offline']),
  model: z.string().max(80).nullable(),
  reviewCount: z.number().int().min(0),
});

/** Public review reads on the PDP (M6.2). */
@Controller('products/:productId/reviews')
export class ProductReviewsController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() q: unknown,
  ): Promise<ReviewPage> {
    return this.reviews.list(productId, listSchema.parse(q));
  }

  @Get('stats')
  @Header('Cache-Control', 'no-store')
  stats(@Param('productId', ParseUUIDPipe) productId: string): Promise<ReviewStats> {
    return this.reviews.stats(productId);
  }

  @Get('eligibility')
  @UseGuards(AccessTokenGuard)
  @Header('Cache-Control', 'no-store')
  eligibility(
    @Auth() auth: AccessClaims,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ReviewEligibility> {
    return this.reviews.eligibility(auth.sub, productId);
  }

  @Post()
  @UseGuards(AccessTokenGuard)
  @RateLimit({ limit: 20, windowSeconds: 3600 })
  create(
    @Auth() auth: AccessClaims,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ): Promise<ReviewView> {
    return this.reviews.create(auth.sub, productId, createSchema.parse(body));
  }
}

/** Shopper actions on reviews: photos, helpful votes, abuse reports. */
@Controller('reviews')
@UseGuards(AccessTokenGuard)
export class ReviewActionsController {
  constructor(private readonly reviews: ReviewService) {}

  @Post('media')
  @RateLimit({ limit: 30, windowSeconds: 3600 })
  upload(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<ReviewMediaUploadResponse> {
    return this.reviews.uploadImage(auth.sub, mediaSchema.parse(body));
  }

  @Put(':id/vote')
  vote(
    @Auth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReviewVoteResponse> {
    return this.reviews.vote(auth.sub, id, true);
  }

  @Delete(':id/vote')
  unvote(
    @Auth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReviewVoteResponse> {
    return this.reviews.vote(auth.sub, id, false);
  }

  @Post(':id/report')
  @HttpCode(200)
  @RateLimit({ limit: 30, windowSeconds: 3600 })
  report(
    @Auth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<{ reported: true }> {
    return this.reviews.report(auth.sub, id, reportSchema.parse(body));
  }
}

/**
 * Moderation queue API for the admin console (M6.5 builds the UI). Internal token until the admin
 * RBAC guard exists; swap the guard there.
 */
@Controller('admin/reviews')
@UseGuards(CatalogInternalGuard)
@SkipRateLimit()
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query() q: unknown): Promise<AdminReviewPage> {
    return this.reviews.adminList(adminListSchema.parse(q));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminReviewView> {
    return this.reviews.adminGet(id);
  }

  @Post(':id/moderate')
  @HttpCode(200)
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<AdminReviewView> {
    return this.reviews.moderate(id, moderateSchema.parse(body));
  }
}

/** Worker endpoints: aggregate refresh and the review summary batch (M6.4). */
@Controller('reviews/internal')
@UseGuards(CatalogInternalGuard)
@SkipRateLimit()
export class ReviewInternalController {
  constructor(private readonly reviews: ReviewService) {}

  @Post('refresh-aggregates')
  @HttpCode(200)
  refresh(): Promise<AggregateRunSummary> {
    return this.reviews.refreshAggregates();
  }

  @Get('summary-candidates')
  candidates(@Query('limit') limit?: string): Promise<SummaryCandidate[]> {
    const n = z.coerce.number().int().min(1).max(100).default(20).parse(limit);
    return this.reviews.summaryCandidates(n);
  }

  @Put('summaries/:productId')
  save(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: unknown,
  ): Promise<{ saved: true }> {
    return this.reviews.saveSummary(productId, summarySchema.parse(body));
  }
}

/** 8 MB JSON only on the review photo route (base64); see sellerUploadBodyParser. */
export function reviewUploadBodyParser(): [string[], RequestHandler] {
  const parse = json({ limit: '8mb' });
  const reviewUploadJson: RequestHandler = (req, res, next) => parse(req, res, next);
  return [['/reviews/media'], reviewUploadJson];
}
