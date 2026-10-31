import { RequestMethod, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, INTERCEPTORS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { StaffRole } from '@shopsphere/types';
import type { SessionService } from '../identity/tokens/session.service';
import type { PrismaService } from '../shared/prisma/prisma.service';
import {
  ADMIN_CONTROLLERS,
  OrdersController,
  PromotionsController,
  UsersController,
} from './admin.controller';
import { AdminAuditInterceptor, StaffGuard } from './rbac';

function guardFor(roles: StaffRole[], status = 'active') {
  const sessions = { authenticate: jest.fn().mockResolvedValue({ sub: 'u1' }) };
  const prisma = {
    staffRole: { findMany: jest.fn().mockResolvedValue(roles.map((role) => ({ role }))) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status, deletedAt: null }) },
  };
  return new StaffGuard(
    sessions as unknown as SessionService,
    prisma as unknown as PrismaService,
    new Reflector(),
  );
}

function ctx(controller: new (...a: never[]) => unknown, method: string, auth = 'Bearer t') {
  const req = { header: () => auth } as unknown as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

const allowed = (roles: StaffRole[], c: new (...a: never[]) => unknown, m: string) =>
  guardFor(roles)
    .canActivate(ctx(c, m))
    .then(
      () => true,
      (e: { status: number }) => {
        if (e.status !== 403) throw e;
        return false;
      },
    );

describe('StaffGuard RBAC (M6.5)', () => {
  it('rejects missing token (401) and non-staff users (403)', async () => {
    await expect(
      guardFor(['SUPPORT']).canActivate(ctx(UsersController, 'list', '')),
    ).rejects.toMatchObject({
      status: 401,
    });
    await expect(allowed([], UsersController, 'list')).resolves.toBe(false);
  });

  it('rejects suspended staff', async () => {
    await expect(
      guardFor(['SUPER_ADMIN'], 'suspended').canActivate(ctx(UsersController, 'list')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it.each<[StaffRole[], new (...a: never[]) => unknown, string, boolean]>([
    [['FINANCE'], OrdersController, 'refund', true],
    [['SUPPORT'], OrdersController, 'refund', false],
    [['CATALOG'], OrdersController, 'refund', false],
    [['SUPPORT'], OrdersController, 'get', true],
    [['CATALOG'], PromotionsController, 'createDeal', true],
    [['FINANCE'], PromotionsController, 'createDeal', false],
    [['FINANCE'], PromotionsController, 'createBankOffer', true],
    [['SUPPORT'], UsersController, 'status', true],
    [['SUPPORT'], UsersController, 'roles', false],
    [['SUPER_ADMIN'], UsersController, 'roles', true],
    [['SUPER_ADMIN'], OrdersController, 'refund', true],
  ])('%j on %p.%s → %s', async (roles, c, m, ok) => {
    await expect(allowed(roles, c, m)).resolves.toBe(ok);
  });
});

describe('admin controllers wiring', () => {
  it('every admin route is behind StaffGuard and every mutation is audited', () => {
    let mutations = 0;
    for (const c of ADMIN_CONTROLLERS) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, c) as unknown[];
      const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, c) as unknown[];
      expect(guards).toContain(StaffGuard);
      expect(interceptors).toContain(AdminAuditInterceptor);
      for (const name of Object.getOwnPropertyNames(c.prototype)) {
        const fn = (c.prototype as unknown as Record<string, unknown>)[name];
        const method = Reflect.getMetadata(METHOD_METADATA, fn as object) as RequestMethod;
        if (method !== undefined && method !== RequestMethod.GET) mutations++;
      }
    }
    expect(mutations).toBeGreaterThanOrEqual(15);
  });
});
