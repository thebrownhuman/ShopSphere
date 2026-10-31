import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService, type AccessClaims } from '../identity/tokens/session.service';
import { SellerAccountService } from '../seller/seller-account.service';
import { AppError } from '../shared/errors/app-error';

type SellerRequest = Request & { auth?: AccessClaims; sellerId?: string };

/**
 * Seller portal auth for fulfilment/payout routes: a live access token whose user owns an
 * APPROVED seller account (seller module, M5.1). Otherwise 403 SELLER_NOT_APPROVED / 404.
 */
@Injectable()
export class SellerGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly accounts: SellerAccountService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<SellerRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new AppError('UNAUTHORIZED', 'Sign in required', 401);
    req.auth = await this.sessions.authenticate(token);
    req.sellerId = (await this.accounts.requireApproved(req.auth.sub)).sellerId;
    return true;
  }
}

export const SellerId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<SellerRequest>().sellerId;
  if (!id) throw new AppError('SELLER_NOT_APPROVED', 'Seller account required', 403);
  return id;
});
