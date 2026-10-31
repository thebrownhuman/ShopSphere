import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { COOKIES, CSRF_HEADER } from './cookies.service';

/**
 * Double-submit CSRF check for routes authenticated by cookie (refresh/logout). A cross-site page
 * cannot read ss_csrf to copy it into the header. Bearer-authenticated mutations are inherently
 * CSRF-safe: browsers never attach the Authorization header on their own.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const cookie = req.cookies?.[COOKIES.csrf] as string | undefined;
    const header = req.header(CSRF_HEADER);
    if (
      !cookie ||
      !header ||
      cookie.length !== header.length ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
    ) {
      throw new AppError('CSRF_FAILED', 'Invalid CSRF token', 403);
    }
    return true;
  }
}
