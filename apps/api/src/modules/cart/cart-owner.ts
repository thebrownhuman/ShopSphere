import { CanActivate, ExecutionContext, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { SessionService } from '../identity/tokens/session.service';
import { AppError } from '../shared/errors/app-error';
import { SignInHooks } from '../shared/events/sign-in-hooks';
import { CART_CONFIG, type CartConfig } from './cart.config';
import { CartService, type CartOwner } from './cart.service';
import { GUEST_CART_COOKIE, signGuestToken, verifyGuestCookie } from './guest-cookie';

/**
 * Resolves the cart owner per request: a valid bearer token means the user's cart (merging any
 * guest cart still in the cookie), otherwise the guest cart named by the signed guest_cart cookie.
 * An invalid bearer token is a 401 (not a silent fall back to guest) so the client refreshes.
 */
@Injectable()
export class CartOwnerResolver implements OnModuleInit {
  constructor(
    private readonly sessions: SessionService,
    private readonly cart: CartService,
    private readonly signInHooks: SignInHooks,
    @Inject(CART_CONFIG) private readonly cfg: CartConfig,
  ) {}

  /** M3.5: merge the guest cart as part of every successful sign-in. */
  onModuleInit(): void {
    this.signInHooks.register(({ userId, req, res }) => this.mergeFromCookie(userId, req, res));
  }

  private guestToken(req: Request): string | null {
    return verifyGuestCookie(req.cookies?.[GUEST_CART_COOKIE], this.cfg.SESSION_COOKIE_SECRET);
  }

  private async mergeFromCookie(userId: string, req: Request, res: Response): Promise<void> {
    const token = this.guestToken(req);
    if (!token) return;
    await this.cart.mergeGuestCart(token, userId);
    this.clearGuest(res);
  }

  async resolve(req: Request, res: Response): Promise<CartOwner> {
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      const claims = await this.sessions.authenticate(token);
      // Safety net for sign-ins that bypassed the hook (e.g. cookie set after sign-in).
      await this.mergeFromCookie(claims.sub, req, res);
      return { userId: claims.sub };
    }
    return { guestToken: this.guestToken(req) };
  }

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.cfg.COOKIE_SECURE, sameSite: 'lax', path: '/' };
  }

  /** (Re)issues the 30-day guest_cart cookie; rolling, like the server-side expiry. */
  setGuest(res: Response, token: string): void {
    res.cookie(GUEST_CART_COOKIE, signGuestToken(token, this.cfg.SESSION_COOKIE_SECRET), {
      ...this.cookieOptions(),
      maxAge: this.cfg.GUEST_CART_DAYS * 86_400_000,
    });
  }

  clearGuest(res: Response): void {
    res.clearCookie(GUEST_CART_COOKIE, this.cookieOptions());
  }
}

/**
 * Guest carts are cookie-authenticated, so writes need CSRF protection. Requiring a JSON body on
 * POST (PATCH/DELETE are never "simple" requests) forces a CORS preflight, which only the
 * configured web origins pass; a cross-site form cannot produce such a request.
 */
@Injectable()
export class JsonWritesGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method === 'POST' && !req.is('application/json')) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send a JSON body', 415);
    }
    return true;
  }
}
