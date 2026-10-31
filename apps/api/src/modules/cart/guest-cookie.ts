import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** httpOnly cookie holding `token.hmac`; the token keys a server-side guest cart (M3.2). */
export const GUEST_CART_COOKIE = 'guest_cart';

export function newGuestToken(): string {
  return randomBytes(24).toString('base64url');
}

function mac(token: string, secret: string): string {
  return createHmac('sha256', secret).update(`guest_cart:${token}`).digest('base64url');
}

export function signGuestToken(token: string, secret: string): string {
  return `${token}.${mac(token, secret)}`;
}

/** Returns the token, or null for a missing, malformed or tampered cookie. */
export function verifyGuestCookie(value: unknown, secret: string): string | null {
  if (typeof value !== 'string') return null;
  const [token, sig] = value.split('.');
  if (!token || !sig || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const expected = Buffer.from(mac(token, secret));
  const actual = Buffer.from(sig);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? token : null;
}
