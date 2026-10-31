import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService, type AccessClaims } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';

type SellerRequest = Request & { auth?: AccessClaims; sellerId?: string };

/**
 * Seller portal auth: a live access token whose user is linked to a seller (seller_users,
 * written by seller onboarding). Non-sellers get 403.
 */
@Injectable()
export class SellerGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<SellerRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new AppError('UNAUTHORIZED', 'Sign in required', 401);
    req.auth = await this.sessions.authenticate(token);
    const link = await this.prisma.sellerUser.findUnique({ where: { userId: req.auth.sub } });
    if (!link) throw new AppError('FORBIDDEN', 'Seller account required', 403);
    req.sellerId = link.sellerId;
    return true;
  }
}

export const SellerId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<SellerRequest>().sellerId;
  if (!id) throw new AppError('FORBIDDEN', 'Seller account required', 403);
  return id;
});
