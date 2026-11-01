import { BASE_SECURITY_HEADERS, buildCsp, createNonce } from '@shopsphere/config/csp';
import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Nonce-based CSP on every page (M7.1); the root layout is dynamic so each render gets one. */
export function middleware(req: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV !== 'production', apiUrl: API_URL });
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
