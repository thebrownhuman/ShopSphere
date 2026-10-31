import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  AdminMe,
  AdminOrderDetail,
  AdminOrderRow,
  AdminProductRow,
  AdminSellerRow,
  AdminUserRow,
  AuditRow,
  Page,
  StaffRole,
  UserStatus,
} from '@shopsphere/types';
import { PaymentService } from '../payment/payment.service';
import { SearchIndexerService } from '../search/search-indexer.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';

const n = (v: bigint | number) => Number(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PageQuery {
  q?: string;
  page: number;
  pageSize: number;
}

const notFound = (what: string) =>
  new AppError('NOT_FOUND', `${what} not found`, HttpStatus.NOT_FOUND);

/** Read models and staff operations behind the admin console (M6.5). */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
    private readonly indexer: SearchIndexerService,
  ) {}

  async me(userId: string, roles: StaffRole[]): Promise<AdminMe> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { identities: true },
    });
    return {
      id: user.id,
      name: user.name,
      email: user.identities.find((i) => i.type === 'email')?.value ?? null,
      roles,
    };
  }

  // ── Users ──

  async users({ q, page, pageSize }: PageQuery): Promise<Page<AdminUserRow>> {
    const term = q?.trim().toLowerCase();
    const where: Prisma.UserWhereInput = term
      ? {
          OR: [
            ...(UUID.test(term) ? [{ id: term }] : []),
            { name: { contains: term, mode: 'insensitive' } },
            { identities: { some: { value: { contains: term } } } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        include: { identities: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    const roles = await this.prisma.staffRole.findMany({
      where: { userId: { in: rows.map((r) => r.id) } },
    });
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.identities.find((i) => i.type === 'email')?.value ?? null,
        phone: u.identities.find((i) => i.type === 'phone')?.value ?? null,
        status: u.deletedAt ? 'deleted' : u.status,
        roles: roles.filter((r) => r.userId === u.id).map((r) => r.role as StaffRole),
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Suspending also revokes every live session so the user is signed out at once. */
  async setUserStatus(actorId: string, id: string, status: UserStatus) {
    if (id === actorId) throw new AppError('SELF_ACTION', 'You cannot change your own status');
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw notFound('User');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status } });
      if (status === 'suspended') {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'admin_suspend' },
        });
      }
    });
    return { id, status, previous: user.status };
  }

  async setRoles(actorId: string, id: string, roles: StaffRole[]) {
    if (id === actorId && !roles.includes('SUPER_ADMIN')) {
      throw new AppError('SELF_ACTION', 'You cannot remove your own super-admin role');
    }
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw notFound('User');
    await this.prisma.$transaction([
      this.prisma.staffRole.deleteMany({ where: { userId: id } }),
      this.prisma.staffRole.createMany({
        data: [...new Set(roles)].map((role) => ({ userId: id, role, grantedBy: actorId })),
      }),
    ]);
    return { id, roles };
  }

  // ── Sellers ──

  async sellers({ q, page, pageSize }: PageQuery): Promise<Page<AdminSellerRow>> {
    const where: Prisma.SellerWhereInput = q?.trim()
      ? { name: { contains: q.trim(), mode: 'insensitive' } }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.seller.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.seller.count({ where }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        city: s.city,
        state: s.state,
        isFirstParty: s.isFirstParty,
        status: s.status,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Suspended sellers' offers drop out of checkout (offer.seller.status check). */
  async setSellerStatus(id: string, status: 'ACTIVE' | 'SUSPENDED') {
    const seller = await this.prisma.seller.findUnique({
      where: { id },
      include: { offers: { select: { sku: { select: { productId: true } } } } },
    });
    if (!seller) throw notFound('Seller');
    await this.prisma.seller.update({ where: { id }, data: { status } });
    await this.reindex([...new Set(seller.offers.map((o) => o.sku.productId))]);
    return { id, status, previous: seller.status };
  }

  // ── Catalog moderation ──

  async products(q: PageQuery & { status?: string }): Promise<Page<AdminProductRow>> {
    const term = q.q?.trim();
    const where: Prisma.ProductWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(term
        ? {
            OR: [
              ...(UUID.test(term) ? [{ id: term }] : []),
              { title: { contains: term, mode: 'insensitive' as const } },
              { slug: { contains: term.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { brand: true, category: true },
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        title: p.title,
        brand: p.brand.name,
        category: p.category.name,
        status: p.status,
        updatedAt: p.updatedAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async setProductStatus(id: string, status: 'ACTIVE' | 'BLOCKED', reason: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw notFound('Product');
    await this.prisma.product.update({ where: { id }, data: { status } });
    await this.reindex([id]);
    return { id, status, previous: product.status, reason };
  }

  /** Search must reflect moderation at once; an index outage must not undo the DB change. */
  private async reindex(ids: string[]) {
    if (!ids.length) return;
    await this.indexer.indexProducts(ids, true).catch(() => undefined);
  }

  // ── Orders ──

  async orders({ q, page, pageSize }: PageQuery): Promise<Page<AdminOrderRow>> {
    const term = q?.trim();
    const where: Prisma.OrderWhereInput = term
      ? {
          OR: [
            { number: { contains: term.toUpperCase() } },
            ...(UUID.test(term) ? [{ id: term }, { userId: term }] : []),
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: rows.map(orderRow), total, page, pageSize };
  }

  async order(id: string): Promise<AdminOrderDetail> {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!o) throw notFound('Order');
    const [user, pay, refunds] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: o.userId }, include: { identities: true } }),
      this.payments.status(o.id),
      this.prisma.refund.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const winner = pay.attempts.find((a) => a.id === pay.winningAttemptId);
    return {
      ...orderRow(o),
      payablePaise: n(o.payablePaise),
      couponCode: o.couponCode,
      customer: {
        name: user?.name ?? null,
        email: user?.identities.find((i) => i.type === 'email')?.value ?? null,
        phone: user?.identities.find((i) => i.type === 'phone')?.value ?? null,
      },
      items: o.items.map((i) => ({
        title: i.title,
        qty: i.qty,
        unitPricePaise: n(i.unitPricePaise),
        sellerId: i.sellerId,
      })),
      events: o.events.map((e) => ({
        toStatus: e.toStatus,
        type: e.type,
        actor: e.actor,
        createdAt: e.createdAt.toISOString(),
      })),
      capturedPaise: winner ? Number(winner.amountPaise) : 0,
      refundedPaise: refunds
        .filter((r) => r.status !== 'FAILED')
        .reduce((a, r) => a + n(r.amount), 0),
      refunds: refunds.map((r) => ({
        id: r.id,
        amountPaise: n(r.amount),
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Manual refund through the payment module's refund API (capped at the captured amount). */
  async refund(orderId: string, amountPaise: number) {
    if (!(await this.prisma.order.findUnique({ where: { id: orderId } }))) throw notFound('Order');
    return this.payments.requestRefund(orderId, BigInt(amountPaise), 'CUSTOMER_REQUEST');
  }

  // ── Audit ──

  async audit(
    q: PageQuery & { entityType?: string; entityId?: string; actorId?: string; action?: string },
  ): Promise<Page<AuditRow>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        actorId: r.actorId,
        actorType: r.actorType,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}

function orderRow(o: {
  id: string;
  number: string;
  userId: string;
  status: string;
  paymentMethod: string;
  totalPaise: bigint;
  placedAt: Date;
}): AdminOrderRow {
  return {
    id: o.id,
    number: o.number,
    userId: o.userId,
    status: o.status,
    paymentMethod: o.paymentMethod,
    totalPaise: n(o.totalPaise),
    placedAt: o.placedAt.toISOString(),
  };
}
