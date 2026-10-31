import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { IdentityConfig } from '../identity.config';
import type { IssuedTokens } from '../tokens/session.service';

export const COOKIES = {
  refresh: 'ss_rt',
  csrf: 'ss_csrf',
  /** Signed, non-authoritative "who is logged in" hint for SSR (uid + name + exp). */
  session: 'ss_session',
  device: 'ss_did',
} as const;

export const CSRF_HEADER = 'x-csrf-token';

export interface SessionCookiePayload {
  uid: string;
  name: string | null;
  exp: number;
}

/** `base64url(json).base64url(hmac)`. Same algorithm lives in apps/web/src/lib/session-cookie.ts. */
export function signSessionCookie(payload: SessionCookiePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionCookie(value: string, secret: string): SessionCookiePayload | null {
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionCookiePayload;
  return payload.exp * 1000 > Date.now() ? payload : null;
}

@Injectable()
export class CookiesService {
  constructor(private readonly config: IdentityConfig) {}

  private base(httpOnly: boolean): CookieOptions {
    return { httpOnly, secure: this.config.env.COOKIE_SECURE, sameSite: 'lax', path: '/' };
  }

  /** Persistent sessions get a 30-day cookie; otherwise a browser-session cookie (no maxAge). */
  setSession(res: Response, tokens: IssuedTokens, user: { id: string; name: string | null }) {
    const maxAge = tokens.persistent ? tokens.sessionExpiresAt.getTime() - Date.now() : undefined;
    res.cookie(COOKIES.refresh, tokens.refreshToken, { ...this.base(true), path: '/auth', maxAge });
    res.cookie(COOKIES.csrf, randomBytes(24).toString('base64url'), {
      ...this.base(false),
      maxAge,
    });
    this.setProfile(res, user, tokens.sessionExpiresAt, maxAge);
  }

  /** Refresh the SSR hint cookie (e.g. after a name change). */
  setProfile(
    res: Response,
    user: { id: string; name: string | null },
    expiresAt: Date,
    maxAge?: number,
  ) {
    const value = signSessionCookie(
      { uid: user.id, name: user.name, exp: Math.floor(expiresAt.getTime() / 1000) },
      this.config.env.SESSION_COOKIE_SECRET,
    );
    res.cookie(COOKIES.session, value, { ...this.base(true), maxAge });
  }

  clearSession(res: Response) {
    res.clearCookie(COOKIES.refresh, { ...this.base(true), path: '/auth' });
    res.clearCookie(COOKIES.csrf, this.base(false));
    res.clearCookie(COOKIES.session, this.base(true));
  }

  /** Long-lived random device id used for new-device alerts. */
  deviceId(req: Request, res: Response): string {
    const existing = req.cookies?.[COOKIES.device] as string | undefined;
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const id = randomBytes(16).toString('base64url');
    res.cookie(COOKIES.device, id, { ...this.base(true), maxAge: 2 * 365 * 24 * 3600 * 1000 });
    return id;
  }
}
