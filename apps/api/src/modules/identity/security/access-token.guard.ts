import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../shared/errors/app-error';
import { SessionService, type AccessClaims } from '../tokens/session.service';

type AuthedRequest = Request & { auth?: AccessClaims };

/** Requires `Authorization: Bearer <access token>` bound to a live session. */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new AppError('UNAUTHORIZED', 'Sign in required', 401);
    req.auth = await this.sessions.authenticate(token);
    return true;
  }
}

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessClaims => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new AppError('UNAUTHORIZED', 'Sign in required', 401);
  return auth;
});
