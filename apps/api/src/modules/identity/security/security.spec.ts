import type Redis from 'ioredis';
import { safeReturnTo } from '../auth/auth.controller';
import { parseIdentifier } from '../identifiers';
import { IdentityConfig } from '../identity.config';
import { MemoryRedis } from '../testing/memory-redis';
import { CaptchaService, TURNSTILE_DUMMY_TOKEN } from './captcha.service';
import { signSessionCookie, verifySessionCookie } from './cookies.service';
import { LoginThrottleService } from './login-throttle.service';

describe('LoginThrottleService', () => {
  afterEach(() => jest.useRealTimers());

  it('requires CAPTCHA after 5 failures per account, for 15 minutes', async () => {
    jest.useFakeTimers();
    const throttle = new LoginThrottleService(new MemoryRedis() as unknown as Redis);
    for (let i = 0; i < 4; i++) await throttle.recordFailure('a@x.in', `10.0.0.${i}`);
    expect(await throttle.captchaRequired('a@x.in', '10.0.0.99')).toBe(false);
    expect(await throttle.recordFailure('a@x.in', '10.0.0.5')).toBe(5);
    expect(await throttle.captchaRequired('a@x.in', '10.0.0.99')).toBe(true);
    jest.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(await throttle.captchaRequired('a@x.in', '10.0.0.99')).toBe(false);
  });

  it('requires CAPTCHA after 5 failures per IP across accounts', async () => {
    const throttle = new LoginThrottleService(new MemoryRedis() as unknown as Redis);
    for (let i = 0; i < 5; i++) await throttle.recordFailure(`user${i}@x.in`, '1.2.3.4');
    expect(await throttle.captchaRequired('fresh@x.in', '1.2.3.4')).toBe(true);
  });

  it('successful login resets the account counter', async () => {
    const throttle = new LoginThrottleService(new MemoryRedis() as unknown as Redis);
    for (let i = 0; i < 5; i++) await throttle.recordFailure('a@x.in', `ip${i}`);
    await throttle.reset('a@x.in');
    expect(await throttle.captchaRequired('a@x.in', 'other')).toBe(false);
  });
});

describe('CaptchaService (Turnstile test keys)', () => {
  const captcha = new CaptchaService({ env: IdentityConfig.parse({}) } as IdentityConfig);
  it('accepts the dummy token and rejects others offline', async () => {
    expect(await captcha.verify(TURNSTILE_DUMMY_TOKEN)).toBe(true);
    expect(await captcha.verify('forged')).toBe(false);
    expect(await captcha.verify(undefined)).toBe(false);
  });
});

describe('session cookie signing', () => {
  const secret = 's'.repeat(40);
  const exp = Math.floor(Date.now() / 1000) + 60;
  it('round-trips and rejects tampering or expiry', () => {
    const v = signSessionCookie({ uid: 'u1', name: 'Asha', exp }, secret);
    expect(verifySessionCookie(v, secret)).toEqual({ uid: 'u1', name: 'Asha', exp });
    const [body] = v.split('.');
    const forged = Buffer.from(JSON.stringify({ uid: 'u2', name: 'X', exp })).toString('base64url');
    expect(verifySessionCookie(v.replace(body, forged), secret)).toBeNull();
    expect(verifySessionCookie(v, 'x'.repeat(40))).toBeNull();
    expect(
      verifySessionCookie(signSessionCookie({ uid: 'u1', name: null, exp: 1 }, secret), secret),
    ).toBeNull();
  });
});

describe('identifiers and redirects', () => {
  it('normalises Indian mobiles and emails', () => {
    expect(parseIdentifier('098765 43210')).toEqual({ type: 'phone', value: '+919876543210' });
    expect(parseIdentifier('+91 9876543210')).toEqual({ type: 'phone', value: '+919876543210' });
    expect(parseIdentifier(' Asha@Example.IN ')).toEqual({
      type: 'email',
      value: 'asha@example.in',
    });
    expect(() => parseIdentifier('12345')).toThrow();
    expect(() => parseIdentifier('5876543210')).toThrow();
  });

  it('only allows same-site return-to paths', () => {
    expect(safeReturnTo('/checkout?step=2')).toBe('/checkout?step=2');
    expect(safeReturnTo('//evil.com')).toBe('/');
    expect(safeReturnTo('https://evil.com')).toBe('/');
    expect(safeReturnTo('/\\evil.com')).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
  });
});
