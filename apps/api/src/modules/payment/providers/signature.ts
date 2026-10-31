import { createHmac, timingSafeEqual } from 'node:crypto';

export function hmacSha256Hex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time comparison of two hex signatures; false on any length/format mismatch. */
export function signaturesMatch(expectedHex: string, actual: string | undefined | null): boolean {
  if (!actual || !/^[0-9a-f]+$/i.test(actual)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(actual.toLowerCase(), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
