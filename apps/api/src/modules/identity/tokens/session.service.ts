import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '../../shared/errors/app-error';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { IDENTITY_LIMITS, IdentityConfig } from '../identity.config';

export interface AccessClaims {
  sub: string;
  sid: string;
}

export interface SessionContext {
  userAgent?: string;
  ip?: string;
  deviceId?: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  sessionId: string;
  persistent: boolean;
  sessionExpiresAt: Date;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Sessions = refresh-token families. Access tokens are 15-minute HS256 JWTs; refresh tokens are
 * opaque, single-use, and rotated on every refresh. Presenting an already-used refresh token is
 * treated as theft: the whole session (family) is revoked.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: IdentityConfig,
  ) {}

  async create(userId: string, persistent: boolean, ctx: SessionContext): Promise<IssuedTokens> {
    const lifetime = persistent
      ? IDENTITY_LIMITS.persistentSessionSeconds
      : IDENTITY_LIMITS.browserSessionSeconds;
    const expiresAt = new Date(Date.now() + lifetime * 1000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        persistent,
        expiresAt,
        userAgent: ctx.userAgent?.slice(0, 500),
        ip: ctx.ip,
        deviceId: ctx.deviceId,
        // Fresh login counts as recent re-auth for step-up purposes.
        reauthAt: new Date(),
      },
    });
    const refreshToken = await this.issueRefresh(session.id, expiresAt);
    return this.bundle(userId, session.id, persistent, expiresAt, refreshToken);
  }

  /** Rotate a refresh token. Reuse of a spent token revokes the session family. */
  async refresh(presented: string): Promise<IssuedTokens> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(presented) },
      include: { session: true },
    });
    if (!record) throw invalidRefresh();
    const { session } = record;
    if (session.revokedAt) throw invalidRefresh();
    if (session.expiresAt <= new Date() || record.expiresAt <= new Date()) {
      throw new AppError('SESSION_EXPIRED', 'Session expired, please sign in again', 401);
    }

    // Atomic claim: only one request can spend a given token.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revoke(session.id, 'refresh_token_reuse');
      this.logger.warn(`refresh token reuse detected, session ${session.id} revoked`);
      throw new AppError('REFRESH_TOKEN_REUSED', 'Session revoked, please sign in again', 401);
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });
    const refreshToken = await this.issueRefresh(session.id, session.expiresAt);
    return this.bundle(
      session.userId,
      session.id,
      session.persistent,
      session.expiresAt,
      refreshToken,
    );
  }

  /** Validate an access token and confirm its session is still live (so logout is immediate). */
  async authenticate(accessToken: string): Promise<AccessClaims> {
    let claims: AccessClaims;
    try {
      claims = jwt.verify(accessToken, this.config.env.JWT_SECRET, {
        algorithms: ['HS256'],
      }) as AccessClaims;
    } catch (err) {
      const expired = err instanceof jwt.TokenExpiredError;
      throw new AppError(
        expired ? 'ACCESS_TOKEN_EXPIRED' : 'UNAUTHORIZED',
        expired ? 'Access token expired' : 'Sign in required',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const session = await this.prisma.session.findUnique({ where: { id: claims.sid } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new AppError('SESSION_EXPIRED', 'Session expired, please sign in again', 401);
    }
    return { sub: claims.sub, sid: claims.sid };
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAll(userId: string, reason: string, exceptSessionId?: string): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }

  /** Revoke the session owning this refresh token, if any (logout from cookie). */
  async revokeByRefreshToken(presented: string, reason: string): Promise<string | null> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(presented) },
    });
    if (!record) return null;
    await this.revoke(record.sessionId, reason);
    return record.sessionId;
  }

  async markReauth(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { reauthAt: new Date() } });
  }

  async requireRecentReauth(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    const cutoff = Date.now() - IDENTITY_LIMITS.reauthValiditySeconds * 1000;
    if (!session?.reauthAt || session.reauthAt.getTime() < cutoff) {
      throw new AppError('REAUTH_REQUIRED', 'Please confirm it is you to continue', 403);
    }
  }

  private async issueRefresh(sessionId: string, expiresAt: Date): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: { sessionId, tokenHash: sha256(token), expiresAt },
    });
    return token;
  }

  private bundle(
    userId: string,
    sessionId: string,
    persistent: boolean,
    sessionExpiresAt: Date,
    refreshToken: string,
  ): IssuedTokens {
    const accessToken = jwt.sign({ sub: userId, sid: sessionId }, this.config.env.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: IDENTITY_LIMITS.accessTokenSeconds,
    });
    return {
      accessToken,
      accessTokenExpiresIn: IDENTITY_LIMITS.accessTokenSeconds,
      refreshToken,
      sessionId,
      persistent,
      sessionExpiresAt,
    };
  }
}

function invalidRefresh() {
  return new AppError('INVALID_REFRESH_TOKEN', 'Please sign in again', HttpStatus.UNAUTHORIZED);
}
