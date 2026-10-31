import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export interface SessionHint {
  uid: string;
  name: string | null;
  exp: number;
}

const SECRET = process.env.SESSION_COOKIE_SECRET ?? 'dev-only-session-cookie-secret-0123456789';

/**
 * Reads the API-signed `ss_session` cookie so server components can greet the user by name.
 * Display only: authorisation always happens in the API with the bearer token.
 * Mirrors apps/api/src/modules/identity/security/cookies.service.ts.
 */
export async function getSessionHint(): Promise<SessionHint | null> {
  const value = (await cookies()).get('ss_session')?.value;
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', SECRET).update(body).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionHint;
    return payload.exp * 1000 > Date.now() ? payload : null;
  } catch {
    return null;
  }
}
