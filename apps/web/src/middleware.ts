import { NextResponse, type NextRequest } from 'next/server';

/**
 * Fast bounce for account pages when there is clearly no session. The client-side RequireAuth
 * guard and the API remain authoritative (cookie may be stale or forged).
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.has('ss_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    url.search = `?returnTo=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/account/:path*'] };
