import {
  CallHandler,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { StaffRole } from '@shopsphere/types';
import type { Request } from 'express';
import { from, mergeMap, type Observable } from 'rxjs';
import { SessionService } from '../identity/tokens/session.service';
import { AuditService } from '../shared/audit/audit.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';

export interface StaffClaims {
  userId: string;
  roles: StaffRole[];
}

type StaffRequest = Request & { staff?: StaffClaims; requestId?: string };

const ROLES_KEY = 'admin:roles';

/**
 * Roles allowed on a route or controller. SUPER_ADMIN always passes. A route with no
 * @Roles is open to any staff member (read-only pages such as /admin/me).
 */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

/** Bearer access token (identity module) + at least one staff_roles row + a role match. */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<StaffRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new AppError('UNAUTHORIZED', 'Sign in required', 401);
    const { sub } = await this.sessions.authenticate(token);
    const rows = await this.prisma.staffRole.findMany({ where: { userId: sub } });
    const roles = rows.map((r) => r.role as StaffRole);
    if (!roles.length) throw new AppError('FORBIDDEN', 'Staff access only', 403);
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user || user.status !== 'active' || user.deletedAt)
      throw new AppError('FORBIDDEN', 'Account disabled', 403);
    const need =
      this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    if (need.length && !roles.includes('SUPER_ADMIN') && !need.some((r) => roles.includes(r))) {
      throw new AppError('FORBIDDEN', `Requires role: ${need.join(' or ')}`, 403, {
        required: need,
      });
    }
    req.staff = { userId: sub, roles };
    return true;
  }
}

export const Staff = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffClaims => {
  const staff = ctx.switchToHttp().getRequest<StaffRequest>().staff;
  if (!staff) throw new AppError('UNAUTHORIZED', 'Sign in required', 401);
  return staff;
});

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x)),
  ) as Prisma.InputJsonValue;
}

/**
 * Every successful admin mutation is written to audit_logs (actor = staff user): action is the
 * handler ("admin.<Controller>.<method>"), entity from the :id param or the response id, `before`
 * = request body, `after` = response. Applied to every admin controller, so no route can forget.
 */
@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<StaffRequest>();
    if (!MUTATING.has(req.method)) return next.handle();
    const controller = ctx.getClass().name.replace(/Controller$/, '');
    const action = `admin.${controller}.${ctx.getHandler().name}`;
    return next.handle().pipe(
      mergeMap((result: unknown) =>
        from(
          (async () => {
            const params = req.params as Record<string, string>;
            const resultId =
              result && typeof result === 'object' && 'id' in result
                ? String((result as { id: unknown }).id)
                : undefined;
            await this.audit.record({
              actorId: req.staff?.userId,
              actorType: 'admin',
              action,
              entityType: controller.toLowerCase(),
              entityId: params.id ?? params.orderId ?? resultId ?? '-',
              before: json(req.body),
              after: json(result),
              requestId: req.requestId,
            });
            return result;
          })(),
        ),
      ),
    );
  }
}
