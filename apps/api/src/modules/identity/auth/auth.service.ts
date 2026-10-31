import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { authenticator } from 'otplib';
import type { User } from '@prisma/client';
import type { AuthUser } from '@shopsphere/types';
import { AuditService } from '../../shared/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { REDIS } from '../../shared/redis/redis.module';
import { parseIdentifier, type Identifier } from '../identifiers';
import { IDENTITY_LIMITS } from '../identity.config';
import { NOTIFICATION_PROVIDER, type NotificationProvider } from '../notify/notification.provider';
import { OtpService } from '../otp/otp.service';
import { CaptchaService } from '../security/captcha.service';
import { LoginThrottleService } from '../security/login-throttle.service';
import { SessionService, type IssuedTokens, type SessionContext } from '../tokens/session.service';

/** Argon2id (algorithm 2) with OWASP-recommended parameters. */
const ARGON = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export type AuthResult =
  | { status: 'authenticated'; user: User; tokens: IssuedTokens }
  | { status: 'signup_required'; signupToken: string }
  | { status: 'mfa_required'; mfaToken: string };

type UserWithIdentities = User & {
  identities: { type: string; value: string; verifiedAt: Date | null }[];
};

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argonVerify(hash, password).catch(() => false);
}

export function toAuthUser(user: UserWithIdentities): AuthUser {
  const find = (type: string) => user.identities.find((i) => i.type === type);
  return {
    id: user.id,
    name: user.name,
    email: find('email')?.value ?? null,
    phone: find('phone')?.value ?? null,
    hasPassword: user.passwordHash !== null,
    totpEnabled: user.totpEnabled,
    googleLinked: find('google') !== undefined,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
    private readonly captcha: CaptchaService,
    private readonly audit: AuditService,
    @Inject(NOTIFICATION_PROVIDER) private readonly notifier: NotificationProvider,
  ) {}

  /** Step 1 of sign-in: tells the UI whether to show OTP, password, or sign-up. */
  async identify(raw: string) {
    const id = parseIdentifier(raw);
    const user = await this.findByIdentifier(id);
    return { type: id.type, exists: user !== null, hasPassword: !!user?.passwordHash };
  }

  async requestLoginOtp(raw: string) {
    return this.otp.request(parseIdentifier(raw), 'login');
  }

  /** OTP login. Unknown identifier → signup_required with a short-lived token for the name step. */
  async verifyLoginOtp(
    raw: string,
    code: string,
    persistent: boolean,
    ctx: SessionContext,
  ): Promise<AuthResult> {
    const id = parseIdentifier(raw);
    await this.otp.verify(id, 'login', code);
    const user = await this.findByIdentifier(id);
    if (!user) {
      const signupToken = await this.putPending('signup', { identifier: id, persistent });
      return { status: 'signup_required', signupToken };
    }
    await this.prisma.userIdentity.updateMany({
      where: { type: id.type, value: id.value, verifiedAt: null },
      data: { verifiedAt: new Date() },
    });
    return this.completeLogin(user, persistent, ctx);
  }

  async completeSignup(
    signupToken: string,
    name: string,
    password: string | undefined,
    ctx: SessionContext,
  ): Promise<AuthResult> {
    const pending = await this.takePending<{ identifier: Identifier; persistent: boolean }>(
      'signup',
      signupToken,
    );
    const { identifier, persistent } = pending;
    const passwordHash = password ? await hashPassword(password) : null;
    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userIdentity.findUnique({
        where: { type_value: { type: identifier.type, value: identifier.value } },
      });
      if (existing)
        throw new AppError('ACCOUNT_EXISTS', 'An account already exists, sign in instead', 409);
      const created = await tx.user.create({
        data: {
          name,
          passwordHash,
          identities: {
            create: { type: identifier.type, value: identifier.value, verifiedAt: new Date() },
          },
        },
      });
      await this.audit.record(
        {
          actorId: created.id,
          actorType: 'user',
          action: 'user.signup',
          entityType: 'user',
          entityId: created.id,
          after: { via: identifier.type },
        },
        tx,
      );
      return created;
    });
    // TODO(M3): merge guest cart into user cart once the cart module exists.
    return this.completeLogin(user, persistent, ctx, { skipDeviceAlert: true });
  }

  async loginWithPassword(
    raw: string,
    password: string,
    persistent: boolean,
    captchaToken: string | undefined,
    ctx: SessionContext,
  ): Promise<AuthResult> {
    const id = parseIdentifier(raw);
    const ip = ctx.ip ?? 'unknown';
    if (await this.throttle.captchaRequired(id.value, ip)) {
      if (!(await this.captcha.verify(captchaToken, ctx.ip))) {
        throw new AppError('CAPTCHA_REQUIRED', 'Please complete the CAPTCHA', 403);
      }
    }
    const user = await this.findByIdentifier(id);
    const ok = user?.passwordHash ? await verifyPassword(user.passwordHash, password) : false;
    if (!user || !ok) {
      const failures = await this.throttle.recordFailure(id.value, ip);
      if (user && failures === IDENTITY_LIMITS.loginFailuresBeforeCaptcha) {
        await this.alertAll(
          user,
          'Unusual sign-in attempts on your ShopSphere account',
          `We saw ${failures} failed sign-in attempts on your account in the last 15 minutes. If this was not you, reset your password.`,
        );
      }
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect email/mobile or password', 401, {
        captchaRequired: failures >= IDENTITY_LIMITS.loginFailuresBeforeCaptcha,
      });
    }
    await this.throttle.reset(id.value);
    return this.completeLogin(user, persistent, ctx);
  }

  async verifyMfa(mfaToken: string, code: string, ctx: SessionContext): Promise<AuthResult> {
    const key = this.pendingKey('mfa', mfaToken);
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError('MFA_EXPIRED', 'Sign-in timed out, start again', 400);
    const pending = JSON.parse(raw) as { userId: string; persistent: boolean; attempts: number };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: pending.userId } });
    if (!user.totpSecret || !authenticator.check(code, user.totpSecret)) {
      if (pending.attempts + 1 >= IDENTITY_LIMITS.otpMaxAttempts) {
        await this.redis.del(key);
        throw new AppError('MFA_LOCKED', 'Too many wrong codes, sign in again', 429);
      }
      await this.redis.set(
        key,
        JSON.stringify({ ...pending, attempts: pending.attempts + 1 }),
        'KEEPTTL',
      );
      throw new AppError('MFA_INVALID', 'Incorrect authenticator code', 400);
    }
    await this.redis.del(key);
    return this.issue(user, pending.persistent, ctx, false);
  }

  async forgotPassword(raw: string) {
    const id = parseIdentifier(raw);
    const user = await this.findByIdentifier(id);
    // Same response either way so the endpoint does not reveal which accounts exist.
    if (!user) return { resendAfterSeconds: IDENTITY_LIMITS.otpResendCooldownSeconds };
    return this.otp.request(id, 'reset');
  }

  /** Reset via OTP, then sign out every session (PRD §3). */
  async resetPassword(raw: string, code: string, newPassword: string) {
    const id = parseIdentifier(raw);
    await this.otp.verify(id, 'reset', code);
    const user = await this.findByIdentifier(id);
    if (!user) throw new AppError('OTP_INVALID', 'Incorrect code', 400);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    await this.sessions.revokeAll(user.id, 'password_reset');
    await this.throttle.reset(id.value);
    await this.audit.record({
      actorId: user.id,
      actorType: 'user',
      action: 'user.password_reset',
      entityType: 'user',
      entityId: user.id,
    });
    await this.alertAll(
      user,
      'Your ShopSphere password was changed',
      'Your password was reset and all devices were signed out. If this was not you, contact support.',
    );
  }

  /** Google OIDC: link by verified email, else create. */
  async loginWithGoogle(
    profile: { sub: string; email: string; emailVerified: boolean; name: string | null },
    ctx: SessionContext,
  ): Promise<AuthResult> {
    if (!profile.emailVerified) {
      throw new AppError('GOOGLE_EMAIL_UNVERIFIED', 'Your Google email is not verified', 400);
    }
    const email = profile.email.toLowerCase();
    let user = await this.findByIdentifier({ type: 'google', value: profile.sub });
    if (!user) {
      user = await this.findByIdentifier({ type: 'email', value: email });
      if (user) {
        await this.prisma.userIdentity.create({
          data: { userId: user.id, type: 'google', value: profile.sub, verifiedAt: new Date() },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            name: profile.name,
            identities: {
              create: [
                { type: 'google', value: profile.sub, verifiedAt: new Date() },
                { type: 'email', value: email, verifiedAt: new Date() },
              ],
            },
          },
        });
      }
    }
    return this.completeLogin(user, true, ctx);
  }

  async getAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { identities: true },
    });
    return toAuthUser(user);
  }

  private async completeLogin(
    user: User,
    persistent: boolean,
    ctx: SessionContext,
    opts: { skipDeviceAlert?: boolean } = {},
  ): Promise<AuthResult> {
    if (user.status !== 'active' || user.deletedAt) {
      throw new AppError('ACCOUNT_DISABLED', 'This account is disabled', HttpStatus.FORBIDDEN);
    }
    if (user.totpEnabled) {
      const mfaToken = await this.putPending('mfa', { userId: user.id, persistent, attempts: 0 });
      return { status: 'mfa_required', mfaToken };
    }
    return this.issue(user, persistent, ctx, opts.skipDeviceAlert ?? false);
  }

  private async issue(
    user: User,
    persistent: boolean,
    ctx: SessionContext,
    skipDeviceAlert: boolean,
  ): Promise<AuthResult> {
    if (ctx.deviceId) await this.trackDevice(user, ctx, skipDeviceAlert);
    const tokens = await this.sessions.create(user.id, persistent, ctx);
    return { status: 'authenticated', user, tokens };
  }

  /** New-device login → alert on every verified contact (skipped for the very first device). */
  private async trackDevice(user: User, ctx: SessionContext, skipAlert: boolean) {
    const deviceId = ctx.deviceId as string;
    const known = await this.prisma.knownDevice.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId } },
    });
    if (known) {
      await this.prisma.knownDevice.update({
        where: { id: known.id },
        data: { lastSeenAt: new Date() },
      });
      return;
    }
    const others = await this.prisma.knownDevice.count({ where: { userId: user.id } });
    await this.prisma.knownDevice.create({
      data: { userId: user.id, deviceId, userAgent: ctx.userAgent?.slice(0, 500) },
    });
    if (others > 0 && !skipAlert) {
      await this.alertAll(
        user,
        'New sign-in to your ShopSphere account',
        `Your account was signed in from a new device (${ctx.userAgent ?? 'unknown browser'}, IP ${ctx.ip ?? 'unknown'}). If this was not you, sign out of all devices and reset your password.`,
      );
    }
  }

  async alertAll(user: User, subject: string, text: string) {
    const contacts = await this.prisma.userIdentity.findMany({
      where: { userId: user.id, type: { in: ['email', 'phone'] }, verifiedAt: { not: null } },
    });
    await Promise.all(
      contacts.map((c) =>
        this.notifier.send({
          to: { type: c.type as Identifier['type'], value: c.value },
          subject,
          text,
        }),
      ),
    );
  }

  private async findByIdentifier(id: { type: string; value: string }): Promise<User | null> {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { type_value: { type: id.type, value: id.value } },
      include: { user: true },
    });
    return identity?.user ?? null;
  }

  private async putPending(kind: 'signup' | 'mfa', value: unknown): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.redis.set(
      this.pendingKey(kind, token),
      JSON.stringify(value),
      'EX',
      IDENTITY_LIMITS.pendingTokenSeconds,
    );
    return token;
  }

  private async takePending<T>(kind: 'signup' | 'mfa', token: string): Promise<T> {
    const key = this.pendingKey(kind, token);
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError('PENDING_EXPIRED', 'This step timed out, start again', 400);
    await this.redis.del(key);
    return JSON.parse(raw) as T;
  }

  private pendingKey(kind: string, token: string) {
    return `auth:pending:${kind}:${token}`;
  }
}
