import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../identity/tokens/session.service';

/** Who is browsing: signed-in user, a guest (X-Guest-Id), or nobody identifiable. */
export interface Viewer {
  userId: string | null;
  /** "u:<userId>" | "g:<guestId>" | null */
  ownerKey: string | null;
}

const GUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Optional auth for public catalog routes: a bad or expired token just means "guest". */
@Injectable()
export class ViewerResolver {
  constructor(private readonly sessions: SessionService) {}

  async resolve(req: Request): Promise<Viewer> {
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme === 'Bearer' && token) {
      try {
        const claims = await this.sessions.authenticate(token);
        return { userId: claims.sub, ownerKey: `u:${claims.sub}` };
      } catch {
        // fall through to guest
      }
    }
    const guest = req.header('x-guest-id');
    return { userId: null, ownerKey: guest && GUEST_ID.test(guest) ? `g:${guest}` : null };
  }
}

export const Req = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Request => ctx.switchToHttp().getRequest<Request>(),
);
