import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import { AppError } from '../../shared/errors/app-error';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { REDIS } from '../../shared/redis/redis.module';
import type { Identifier } from '../identifiers';
import { IDENTITY_LIMITS, IdentityConfig } from '../identity.config';
import { NOTIFICATION_PROVIDER, type NotificationProvider } from '../notify/notification.provider';

export type OtpPurpose = 'login' | 'reset' | 'change' | 'reauth';

interface StoredOtp {
  hash: string;
  attempts: number;
  challengeId: string;
}

const PURPOSE_TEXT: Record<OtpPurpose, string> = {
  login: 'to sign in to ShopSphere',
  reset: 'to reset your ShopSphere password',
  change: 'to verify your new ShopSphere contact',
  reauth: 'to confirm it is you',
};

/**
 * 6-digit OTPs. Only an HMAC of the code is stored, in Redis with a 5-minute TTL.
 * Max 5 wrong attempts per code (then it is burned), 30-second resend cooldown.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(NOTIFICATION_PROVIDER) private readonly notifier: NotificationProvider,
    private readonly prisma: PrismaService,
    private readonly config: IdentityConfig,
  ) {}

  async request(to: Identifier, purpose: OtpPurpose): Promise<{ resendAfterSeconds: number }> {
    const cooldown = await this.redis.set(
      this.cooldownKey(to, purpose),
      '1',
      'EX',
      IDENTITY_LIMITS.otpResendCooldownSeconds,
      'NX',
    );
    if (cooldown === null) {
      const ttl = await this.redis.ttl(this.cooldownKey(to, purpose));
      throw new AppError('OTP_COOLDOWN', 'Please wait before requesting another code', 429, {
        retryAfterSeconds: Math.max(ttl, 1),
      });
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        channel: to.type,
        target: to.value,
        purpose,
        expiresAt: new Date(Date.now() + IDENTITY_LIMITS.otpTtlSeconds * 1000),
      },
    });
    const stored: StoredOtp = {
      hash: this.hash(to, purpose, code),
      attempts: 0,
      challengeId: challenge.id,
    };
    await this.redis.set(
      this.codeKey(to, purpose),
      JSON.stringify(stored),
      'EX',
      IDENTITY_LIMITS.otpTtlSeconds,
    );
    await this.notifier.send({
      to,
      subject: `${code} is your ShopSphere code`,
      text: `${code} is your ShopSphere verification code ${PURPOSE_TEXT[purpose]}. It expires in 5 minutes. Never share it.`,
    });
    return { resendAfterSeconds: IDENTITY_LIMITS.otpResendCooldownSeconds };
  }

  /** Consumes the code on success. Throws OTP_INVALID / OTP_EXPIRED / OTP_LOCKED. */
  async verify(to: Identifier, purpose: OtpPurpose, code: string): Promise<void> {
    const key = this.codeKey(to, purpose);
    const raw = await this.redis.get(key);
    if (!raw)
      throw new AppError('OTP_EXPIRED', 'Code expired, request a new one', HttpStatus.BAD_REQUEST);
    const stored = JSON.parse(raw) as StoredOtp;
    if (stored.attempts >= IDENTITY_LIMITS.otpMaxAttempts) {
      await this.redis.del(key);
      throw this.locked();
    }

    const expected = Buffer.from(stored.hash, 'hex');
    const actual = Buffer.from(this.hash(to, purpose, code), 'hex');
    if (/^\d{6}$/.test(code) && timingSafeEqual(expected, actual)) {
      await this.redis.del(key);
      await this.prisma.otpChallenge.update({
        where: { id: stored.challengeId },
        data: { verifiedAt: new Date(), attempts: stored.attempts + 1 },
      });
      return;
    }

    const attempts = stored.attempts + 1;
    await this.prisma.otpChallenge.update({
      where: { id: stored.challengeId },
      data: { attempts },
    });
    if (attempts >= IDENTITY_LIMITS.otpMaxAttempts) {
      await this.redis.del(key);
      throw this.locked();
    }
    await this.redis.set(key, JSON.stringify({ ...stored, attempts }), 'KEEPTTL');
    throw new AppError('OTP_INVALID', 'Incorrect code', HttpStatus.BAD_REQUEST, {
      attemptsLeft: IDENTITY_LIMITS.otpMaxAttempts - attempts,
    });
  }

  private locked() {
    return new AppError('OTP_LOCKED', 'Too many wrong attempts, request a new code', 429);
  }

  private hash(to: Identifier, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.config.env.JWT_SECRET)
      .update(`${purpose}:${to.value}:${code}`)
      .digest('hex');
  }

  private codeKey(to: Identifier, purpose: OtpPurpose) {
    return `otp:${purpose}:${to.value}`;
  }

  private cooldownKey(to: Identifier, purpose: OtpPurpose) {
    return `otp:cd:${purpose}:${to.value}`;
  }
}
