import type Redis from 'ioredis';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { Identifier } from '../identifiers';
import { IdentityConfig } from '../identity.config';
import type { NotificationProvider, OutboundMessage } from '../notify/notification.provider';
import { MemoryRedis } from '../testing/memory-redis';
import { OtpService } from './otp.service';

const phone: Identifier = { type: 'phone', value: '+919876543210' };

function setup() {
  const sent: OutboundMessage[] = [];
  const notifier: NotificationProvider = { send: async (m) => void sent.push(m) };
  const prisma = {
    otpChallenge: {
      create: jest.fn().mockResolvedValue({ id: 'c1' }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const config = { env: IdentityConfig.parse({}) } as IdentityConfig;
  const redis = new MemoryRedis();
  const otp = new OtpService(
    redis as unknown as Redis,
    notifier,
    prisma as unknown as PrismaService,
    config,
  );
  const lastCode = () => /(\d{6})/.exec(sent[sent.length - 1].text)?.[1] as string;
  return { otp, sent, prisma, lastCode };
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('OtpService', () => {
  afterEach(() => jest.useRealTimers());

  it('sends a 6-digit code and verifies it once', async () => {
    const { otp, lastCode } = setup();
    await otp.request(phone, 'login');
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    await expect(otp.verify(phone, 'login', code)).resolves.toBeUndefined();
    // Consumed: replay fails.
    await expect(otp.verify(phone, 'login', code)).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('burns the code after 5 wrong attempts (brute-force limit)', async () => {
    const { otp, lastCode } = setup();
    await otp.request(phone, 'login');
    const code = lastCode();
    for (let i = 1; i <= 4; i++) {
      await expect(otp.verify(phone, 'login', wrong(code))).rejects.toMatchObject({
        code: 'OTP_INVALID',
        details: { attemptsLeft: 5 - i },
      });
    }
    await expect(otp.verify(phone, 'login', wrong(code))).rejects.toMatchObject({
      code: 'OTP_LOCKED',
    });
    // Even the right code no longer works: attacker cannot keep guessing.
    await expect(otp.verify(phone, 'login', code)).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('enforces the 30-second resend cooldown', async () => {
    jest.useFakeTimers();
    const { otp } = setup();
    await otp.request(phone, 'login');
    await expect(otp.request(phone, 'login')).rejects.toMatchObject({
      code: 'OTP_COOLDOWN',
      status: 429,
    });
    jest.advanceTimersByTime(30_000);
    await expect(otp.request(phone, 'login')).resolves.toEqual({ resendAfterSeconds: 30 });
  });

  it('resend does not reset the attempt budget into an unlimited one', async () => {
    jest.useFakeTimers();
    const { otp, lastCode } = setup();
    await otp.request(phone, 'login');
    for (let i = 0; i < 4; i++) await otp.verify(phone, 'login', wrong(lastCode())).catch(() => {});
    jest.advanceTimersByTime(30_000);
    await otp.request(phone, 'login');
    // New code, new 5-attempt budget, but each resend costs 30 s: ≤ 10 guesses/min against 1e6 codes.
    await expect(otp.verify(phone, 'login', lastCode())).resolves.toBeUndefined();
  });

  it('expires codes after 5 minutes', async () => {
    jest.useFakeTimers();
    const { otp, lastCode } = setup();
    await otp.request(phone, 'login');
    const code = lastCode();
    jest.advanceTimersByTime(5 * 60_000 + 1);
    await expect(otp.verify(phone, 'login', code)).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('scopes codes by purpose', async () => {
    const { otp, lastCode } = setup();
    await otp.request(phone, 'login');
    await expect(otp.verify(phone, 'reset', lastCode())).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
  });

  it('never stores the plaintext code', async () => {
    const { otp, lastCode, prisma } = setup();
    await otp.request(phone, 'login');
    expect(JSON.stringify(prisma.otpChallenge.create.mock.calls)).not.toContain(lastCode());
  });
});
