import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { AppError } from '../../shared/errors/app-error';
import { REDIS } from '../../shared/redis/redis.module';
import { IdentityConfig } from '../identity.config';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/**
 * Google OIDC authorization-code flow. Disabled (GOOGLE_DISABLED) unless GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET are set. State is a one-time Redis key carrying the return-to path.
 */
@Injectable()
export class GoogleService {
  constructor(
    private readonly config: IdentityConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  get enabled(): boolean {
    return this.config.googleEnabled;
  }

  private get redirectUri() {
    return `${this.config.env.API_URL}/auth/google/callback`;
  }

  async authorizationUrl(returnTo: string): Promise<string> {
    this.assertEnabled();
    const state = randomBytes(24).toString('base64url');
    await this.redis.set(`auth:google:${state}`, returnTo, 'EX', 600);
    const params = new URLSearchParams({
      client_id: this.config.env.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Returns the return-to path and the verified profile. */
  async exchange(
    code: string,
    state: string,
  ): Promise<{ returnTo: string; profile: GoogleProfile }> {
    this.assertEnabled();
    const key = `auth:google:${state}`;
    const returnTo = await this.redis.get(key);
    if (!returnTo)
      throw new AppError('GOOGLE_STATE_INVALID', 'Google sign-in expired, try again', 400);
    await this.redis.del(key);

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.env.GOOGLE_CLIENT_ID,
        client_secret: this.config.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new AppError('GOOGLE_EXCHANGE_FAILED', 'Google sign-in failed', 502);
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    // Userinfo over TLS with a fresh access token is equivalent to validating the id_token here.
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok) throw new AppError('GOOGLE_EXCHANGE_FAILED', 'Google sign-in failed', 502);
    const info = (await infoRes.json()) as {
      sub: string;
      email: string;
      email_verified: boolean;
      name?: string;
    };
    return {
      returnTo,
      profile: {
        sub: info.sub,
        email: info.email,
        emailVerified: info.email_verified,
        name: info.name ?? null,
      },
    };
  }

  private assertEnabled() {
    if (!this.enabled)
      throw new AppError('GOOGLE_DISABLED', 'Google sign-in is not configured', 404);
  }
}
