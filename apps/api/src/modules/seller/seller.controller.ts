import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type {
  BulkReport,
  InventoryPage,
  InventoryRow,
  ListingCreated,
  MediaUploadResponse,
  SellerAccountView,
  SellerAttribute,
  SellerCategory,
  SellerDashboard,
} from '@shopsphere/types';
import { json } from 'body-parser';
import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  CATALOG_CONFIG,
  CatalogInternalGuard,
  type CatalogConfig,
} from '../catalog/catalog.config';
import { AccessTokenGuard, Auth } from '../identity/security/access-token.guard';
import type { AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { RateLimit, SkipRateLimit } from '../shared/rate-limit/rate-limit.decorator';
import { Inject } from '@nestjs/common';
import { BulkListingService } from './bulk-listing.service';
import { InventoryService } from './inventory.service';
import { ListingService } from './listing.service';
import { SellerAccountService } from './seller-account.service';

/**
 * Route-scoped JSON limit for base64 uploads; the global parser keeps its 100 kB default and
 * skips bodies already parsed here. Wrapped because Nest skips registering its own parser when a
 * middleware named `jsonParser` is already mounted.
 */
export function sellerUploadBodyParser(): [string[], RequestHandler] {
  const parse = json({ limit: '8mb' });
  const sellerUploadJson: RequestHandler = (req, res, next) => parse(req, res, next);
  return [['/seller/media', '/seller/listings/bulk'], sellerUploadJson];
}

const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const pickup = z.object({
  name: trimmed(80),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'),
  line1: trimmed(200),
  line2: z.string().trim().max(200).nullable().default(null),
  city: trimmed(80),
  state: trimmed(80),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode'),
});
const registerSchema = z.object({ displayName: z.string().trim().min(2).max(80) });
const kycSchema = z.object({
  legalName: z.string().trim().min(2).max(120).optional(),
  pan: z.string().max(20).optional(),
  gstin: z.string().max(20).optional(),
  pickup: pickup.optional(),
});
const bankSchema = z.object({
  holderName: z.string().trim().min(2).max(120),
  accountNumber: z.string().max(30),
  ifsc: z.string().max(20),
});
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const queueSchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).default('SUBMITTED'),
});
const mediaSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(MEDIA_TYPES),
  dataBase64: z.string().min(4),
});
const paise = z.number().int().positive().max(1e11);
const listingSchema = z.object({
  categoryId: z.string().uuid(),
  title: z.string().max(200),
  brand: z.string().max(80),
  description: z.string().max(5000).optional(),
  countryOfOrigin: z.string().trim().min(2).max(60).optional(),
  bullets: z.array(z.string().max(300)).max(10).optional(),
  specs: z.record(z.string().max(200)).optional(),
  images: z.array(z.string().max(500)).max(10).optional(),
  variants: z
    .array(
      z.object({
        attributes: z.record(z.string().max(80)),
        skuCode: z.string().max(64).optional(),
        price: paise,
        mrp: paise,
        stock: z.number().int().min(0),
        images: z.array(z.string().max(500)).max(10).optional(),
      }),
    )
    .min(1)
    .max(100),
});
const inventorySchema = z.object({
  q: z.string().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const patchSchema = z
  .object({
    price: paise.optional(),
    mrp: paise.optional(),
    stock: z.number().int().min(0).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, 'Nothing to update');
const bulkSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  dataBase64: z.string().min(1),
  dryRun: z.boolean().optional(),
});

/** Seller Central API (M5.1–M5.4, M5.8). */
@Controller('seller')
@UseGuards(AccessTokenGuard)
export class SellerController {
  constructor(
    private readonly accounts: SellerAccountService,
    private readonly listings: ListingService,
    private readonly bulk: BulkListingService,
    private readonly inventory: InventoryService,
    private readonly prisma: PrismaService,
    @Inject(CATALOG_CONFIG) private readonly catalogCfg: CatalogConfig,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Auth() auth: AccessClaims): Promise<SellerAccountView> {
    return this.accounts.me(auth.sub);
  }

  @Post('register')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  register(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<SellerAccountView> {
    return this.accounts.register(auth.sub, registerSchema.parse(body).displayName);
  }

  @Patch('kyc')
  kyc(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<SellerAccountView> {
    return this.accounts.updateKyc(auth.sub, kycSchema.parse(body));
  }

  @Post('kyc/bank')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  bank(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<SellerAccountView> {
    return this.accounts.verifyBank(auth.sub, bankSchema.parse(body));
  }

  @Post('kyc/submit')
  @HttpCode(200)
  submit(@Auth() auth: AccessClaims): Promise<SellerAccountView> {
    return this.accounts.submit(auth.sub);
  }

  // ───────── Listings (approved sellers) ─────────

  @Get('categories')
  async categories(@Auth() auth: AccessClaims): Promise<SellerCategory[]> {
    await this.accounts.requireApproved(auth.sub);
    return this.listings.leafCategories();
  }

  @Get('categories/:id/attributes')
  async attributes(
    @Auth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SellerAttribute[]> {
    await this.accounts.requireApproved(auth.sub);
    return this.listings.attributes(id);
  }

  @Post('media')
  @RateLimit({ limit: 60, windowSeconds: 3600 })
  async upload(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<MediaUploadResponse> {
    const acc = await this.accounts.requireApproved(auth.sub);
    const req = mediaSchema.parse(body);
    const bytes = Buffer.from(req.dataBase64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) {
      throw new AppError('UPLOAD_INVALID', 'Images must be up to 2 MB', 422);
    }
    if (!matchesMagic(bytes, req.contentType)) {
      throw new AppError('UPLOAD_INVALID', `File is not a ${req.contentType}`, 422);
    }
    const row = await this.prisma.sellerMedia.create({
      data: {
        sellerAccountId: acc.id,
        fileName: req.fileName,
        contentType: req.contentType,
        bytes,
        sizeBytes: bytes.length,
      },
      select: { id: true },
    });
    return { id: row.id, url: `${this.catalogCfg.API_URL}/seller/media/${row.id}` };
  }

  @Post('listings')
  async createListing(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<ListingCreated> {
    const acc = await this.accounts.requireApproved(auth.sub);
    return this.listings.create(
      { sellerId: acc.sellerId, accountId: acc.id, isFirstParty: acc.isFirstParty },
      listingSchema.parse(body),
    );
  }

  @Get('listings/bulk/template.csv')
  async template(
    @Auth() auth: AccessClaims,
    @Query('categoryId', ParseUUIDPipe) categoryId: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.accounts.requireApproved(auth.sub);
    const { fileName, csv } = await this.bulk.template(categoryId);
    res
      .type('text/csv; charset=utf-8')
      .attachment(fileName)
      .send(String.fromCharCode(0xfeff) + csv);
  }

  @Post('listings/bulk')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowSeconds: 3600 })
  async bulkUpload(@Auth() auth: AccessClaims, @Body() body: unknown): Promise<BulkReport> {
    const acc = await this.accounts.requireApproved(auth.sub);
    return this.bulk.upload(
      { sellerId: acc.sellerId, accountId: acc.id, isFirstParty: acc.isFirstParty },
      bulkSchema.parse(body),
    );
  }

  @Get('inventory')
  @Header('Cache-Control', 'no-store')
  async list(@Auth() auth: AccessClaims, @Query() query: unknown): Promise<InventoryPage> {
    const acc = await this.accounts.requireApproved(auth.sub);
    return this.inventory.list(acc.sellerId, inventorySchema.parse(query));
  }

  @Patch('offers/:id')
  async patchOffer(
    @Auth() auth: AccessClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<InventoryRow> {
    const acc = await this.accounts.requireApproved(auth.sub);
    return this.inventory.patch(acc.sellerId, id, patchSchema.parse(body));
  }

  @Get('dashboard')
  @Header('Cache-Control', 'no-store')
  async dashboard(@Auth() auth: AccessClaims): Promise<SellerDashboard> {
    const acc = await this.accounts.requireApproved(auth.sub);
    return this.inventory.dashboard(acc.sellerId);
  }
}

/** Public image bytes for storefront `<img>` tags (no auth). */
@Controller('seller/media')
@SkipRateLimit()
export class SellerMediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async media(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const row = await this.prisma.sellerMedia.findUnique({ where: { id } });
    if (!row) throw new AppError('NOT_FOUND', 'Image not found', 404);
    res
      .type(row.contentType)
      .set('Cache-Control', 'public, max-age=31536000, immutable')
      .set('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(row.bytes));
  }
}

/** Seller approval queue. Internal token until the admin console (M6) adds staff roles. */
@Controller('seller/admin/applications')
@UseGuards(CatalogInternalGuard)
export class SellerAdminController {
  constructor(private readonly accounts: SellerAccountService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  queue(@Query() query: unknown): Promise<SellerAccountView[]> {
    return this.accounts.queue(queueSchema.parse(query).status);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<SellerAccountView> {
    return this.accounts.approve(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<SellerAccountView> {
    return this.accounts.reject(id, rejectSchema.parse(body).reason);
  }
}

function matchesMagic(b: Buffer, type: (typeof MEDIA_TYPES)[number]): boolean {
  if (type === 'image/png')
    return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return (
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}
