import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { STAFF_ROLES } from '@shopsphere/types';
import { z } from 'zod';
import { PromotionsService } from '../promotions/promotions.service';
import { SellerAccountService } from '../seller/seller-account.service';
import { AdminService } from './admin.service';
import { HomeCmsService } from './home-cms.service';
import { AdminAuditInterceptor, Roles, Staff, StaffGuard, type StaffClaims } from './rbac';

const pageSchema = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const iso = z.string().datetime({ offset: true });
const paise = z.number().int().min(0).max(1e12);

const userStatusSchema = z.object({ status: z.enum(['active', 'suspended']) });
const rolesSchema = z.object({ roles: z.array(z.enum(STAFF_ROLES)).max(4) });
const sellerStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) });
const productStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BLOCKED']),
  reason: z.string().trim().min(3).max(500),
});
const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const appQueueSchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).default('SUBMITTED'),
});
const refundSchema = z.object({
  amountPaise: z.number().int().positive().max(1e12),
  note: z.string().trim().min(3).max(500),
});
const auditSchema = pageSchema.extend({
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
});

const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
    description: z.string().max(200).default(''),
    type: z.enum(['FLAT', 'PERCENT']),
    value: z.number().int().positive(),
    minOrderPaise: paise.default(0),
    maxDiscountPaise: paise.nullable().default(null),
    perUserLimit: z.number().int().min(1).max(100).default(1),
    totalLimit: z.number().int().min(1).nullable().default(null),
    startsAt: iso,
    endsAt: iso,
    active: z.boolean().default(true),
  })
  .refine((c) => c.type !== 'PERCENT' || c.value <= 10_000, 'Percent is in basis points (≤ 10000)')
  .refine((c) => new Date(c.endsAt) > new Date(c.startsAt), 'End must be after start');

const dealSchema = z
  .object({
    offerId: z.string().uuid(),
    title: z.string().trim().max(200).optional(),
    dealPricePaise: z.number().int().positive(),
    quantityCap: z.number().int().min(1).max(100_000),
    startsAt: iso,
    endsAt: iso,
    active: z.boolean().optional(),
  })
  .refine((d) => new Date(d.endsAt) > new Date(d.startsAt), 'End must be after start');
const dealPatchSchema = z.object({
  active: z.boolean().optional(),
  endsAt: iso.optional(),
  quantityCap: z.number().int().min(1).max(100_000).optional(),
});

const bankOfferSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    percentBp: z.number().int().min(1).max(10_000),
    maxDiscountPaise: paise.nullable().default(null),
    minOrderPaise: paise.default(0),
    startsAt: iso,
    endsAt: iso,
    active: z.boolean().default(true),
  })
  .refine((o) => new Date(o.endsAt) > new Date(o.startsAt), 'End must be after start');

const SECTION_TYPES = [
  'HERO_CAROUSEL',
  'QUAD_CARDS',
  'DEAL_ROW',
  'PRODUCT_CAROUSEL',
  'RECENTLY_VIEWED',
  'CATEGORY_TILES',
] as const;
const sectionSchema = z.object({
  type: z.enum(SECTION_TYPES),
  title: z.string().trim().min(1).max(200),
  dataSource: z.record(z.unknown()).default({}),
  audience: z.enum(['ALL', 'GUEST', 'SIGNED_IN']).default('ALL'),
  active: z.boolean().default(true),
  startsAt: iso.nullable().default(null),
  endsAt: iso.nullable().default(null),
});
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
const previewSchema = z.object({
  at: iso.optional(),
  audience: z.enum(['GUEST', 'SIGNED_IN']).default('GUEST'),
});

/**
 * Every admin controller: staff guard (RBAC) + audit interceptor. Roles per controller/route;
 * SUPER_ADMIN passes every check.
 */
const AdminApi = () =>
  applyDecorators(UseGuards(StaffGuard), UseInterceptors(AdminAuditInterceptor));

@Controller('admin')
@UseGuards(StaffGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('me')
  me(@Staff() staff: StaffClaims) {
    return this.admin.me(staff.userId, staff.roles);
  }
}

@Controller('admin/users')
@AdminApi()
@Roles('SUPPORT')
export class UsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query() q: unknown) {
    return this.admin.users(pageSchema.parse(q));
  }

  @Post(':id/status')
  @HttpCode(200)
  status(
    @Staff() staff: StaffClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.admin.setUserStatus(staff.userId, id, userStatusSchema.parse(body).status);
  }

  @Put(':id/roles')
  @Roles('SUPER_ADMIN')
  roles(
    @Staff() staff: StaffClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.admin.setRoles(staff.userId, id, rolesSchema.parse(body).roles);
  }
}

@Controller('admin/sellers')
@AdminApi()
@Roles('CATALOG')
export class SellersController {
  constructor(
    private readonly admin: AdminService,
    private readonly accounts: SellerAccountService,
  ) {}

  @Get()
  @Roles('CATALOG', 'SUPPORT')
  list(@Query() q: unknown) {
    return this.admin.sellers(pageSchema.parse(q));
  }

  /** KYC approval queue (seller module's account service). */
  @Get('applications')
  applications(@Query() q: unknown) {
    return this.accounts.queue(appQueueSchema.parse(q).status);
  }

  @Post('applications/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.approve(id);
  }

  @Post('applications/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.accounts.reject(id, rejectSchema.parse(body).reason);
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.admin.setSellerStatus(id, sellerStatusSchema.parse(body).status);
  }
}

@Controller('admin/products')
@AdminApi()
@Roles('CATALOG')
export class CatalogController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query() q: unknown) {
    const parsed = pageSchema
      .extend({ status: z.enum(['ACTIVE', 'DRAFT', 'BLOCKED']).optional() })
      .parse(q);
    return this.admin.products(parsed);
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status, reason } = productStatusSchema.parse(body);
    return this.admin.setProductStatus(id, status, reason);
  }
}

@Controller('admin/orders')
@AdminApi()
@Roles('SUPPORT', 'FINANCE')
export class OrdersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query() q: unknown) {
    return this.admin.orders(pageSchema.parse(q));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.order(id);
  }

  /** Manual refund: finance only. The note is kept in the audit log (request body). */
  @Post(':orderId/refunds')
  @Roles('FINANCE')
  refund(@Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: unknown) {
    return this.admin.refund(orderId, refundSchema.parse(body).amountPaise);
  }
}

@Controller('admin/audit')
@AdminApi()
@Roles('FINANCE')
export class AuditController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query() q: unknown) {
    return this.admin.audit(auditSchema.parse(q));
  }
}

@Controller('admin/promotions')
@AdminApi()
@Roles('CATALOG')
export class PromotionsController {
  constructor(private readonly promos: PromotionsService) {}

  @Get('coupons')
  coupons() {
    return this.promos.listCoupons();
  }

  @Post('coupons')
  createCoupon(@Body() body: unknown) {
    return this.promos.saveCoupon(couponSchema.parse(body));
  }

  @Put('coupons/:id')
  updateCoupon(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.promos.saveCoupon(couponSchema.parse(body), id);
  }

  @Get('offers')
  offers(@Query() q: unknown) {
    return this.promos.searchOffers(z.object({ q: z.string().min(2).max(100) }).parse(q).q);
  }

  @Get('deals')
  deals() {
    return this.promos.listDeals();
  }

  @Post('deals')
  createDeal(@Body() body: unknown) {
    return this.promos.createDeal(dealSchema.parse(body));
  }

  @Put('deals/:id')
  updateDeal(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.promos.updateDeal(id, dealPatchSchema.parse(body));
  }

  @Get('bank-offers')
  @Roles('CATALOG', 'FINANCE')
  bankOffers() {
    return this.promos.listBankOffers();
  }

  @Post('bank-offers')
  @Roles('CATALOG', 'FINANCE')
  createBankOffer(@Body() body: unknown) {
    return this.promos.saveBankOffer(bankOfferSchema.parse(body));
  }

  @Put('bank-offers/:id')
  @Roles('CATALOG', 'FINANCE')
  updateBankOffer(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.promos.saveBankOffer(bankOfferSchema.parse(body), id);
  }
}

@Controller('admin/home')
@AdminApi()
@Roles('CATALOG')
export class HomeCmsController {
  constructor(private readonly cms: HomeCmsService) {}

  @Get('sections')
  list() {
    return this.cms.list();
  }

  @Post('sections')
  create(@Body() body: unknown) {
    return this.cms.create(sectionSchema.parse(body));
  }

  @Put('sections/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.cms.update(id, sectionSchema.parse(body));
  }

  @Delete('sections/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.cms.remove(id);
  }

  @Post('sections/reorder')
  @HttpCode(200)
  reorder(@Body() body: unknown) {
    return this.cms.reorder(reorderSchema.parse(body).ids);
  }

  @Get('preview')
  preview(@Query() q: unknown) {
    const { at, audience } = previewSchema.parse(q);
    return this.cms.preview(at ? new Date(at) : new Date(), audience);
  }
}

export const ADMIN_CONTROLLERS = [
  AdminController,
  UsersController,
  SellersController,
  CatalogController,
  OrdersController,
  AuditController,
  PromotionsController,
  HomeCmsController,
];
