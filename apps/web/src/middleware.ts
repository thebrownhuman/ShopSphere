import { BASE_SECURITY_HEADERS, buildCsp, createNonce } from '@shopsphere/config/csp';
import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const DEV = process.env.NODE_ENV !== 'production';

/**
 * Routes rendered per request get a nonce-based CSP ('strict-dynamic', no inline script).
 * Everything else is ISR/static HTML built ahead of time, so it cannot carry a per-request
 * nonce; it gets the same policy with 'unsafe-inline' scripts (still no eval, no plugins,
 * no framing, locked connect/form targets). See docs/security/asvs-checklist.md (V14.4.3).
 */
const NONCE_ROUTES = /^\/(checkout|account|signin|orders|cart)(\/|$)/;

const shared = {
  dev: DEV,
  apiUrl: API_URL,
  scriptSrc: ['https://checkout.razorpay.com', 'https://challenges.cloudflare.com'],
  connectSrc: [
    'https://api.razorpay.com',
    'https://lumberjack.razorpay.com',
    'https://challenges.cloudflare.com',
  ],
  frameSrc: [
    'https://api.razorpay.com',
    'https://checkout.razorpay.com',
    'https://challenges.cloudflare.com',
  ],
};

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Fast bounce for account pages when there is clearly no session. The client-side
  // RequireAuth guard and the API remain authoritative (cookie may be stale or forged).
  if (path.startsWith('/account') && !req.cookies.has('ss_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    url.search = `?returnTo=${encodeURIComponent(path + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = NONCE_ROUTES.test(path) ? createNonce() : undefined;
  const csp = buildCsp({ ...shared, nonce });
  const headers = new Headers(req.headers);
  if (nonce) {
    // Next.js reads the nonce from the request CSP header and stamps its own scripts.
    headers.set('x-nonce', nonce);
    headers.set('content-security-policy', csp);
  }
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|img/|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
