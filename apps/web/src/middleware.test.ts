// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';

const run = (path: string, cookie?: string) =>
  middleware(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: cookie ? { cookie } : undefined,
    }),
  );

describe('security headers middleware (M7.1)', () => {
  it('per-request routes get a nonce + strict-dynamic CSP, no inline script', () => {
    const res = run('/checkout');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]{20,}' 'strict-dynamic'/);
    expect(csp).not.toContain("'unsafe-inline' https://checkout");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Next reads the nonce from the forwarded request headers.
    expect(res.headers.get('x-middleware-request-x-nonce')).toBeTruthy();
    expect(run('/checkout').headers.get('content-security-policy')).not.toBe(csp);
  });

  it('ISR catalogue pages get the static policy and every page gets HSTS etc.', () => {
    const res = run('/p/some-phone');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).not.toContain('nonce-');
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('strict-transport-security')).toContain('max-age=');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('still bounces signed-out visitors away from /account', () => {
    const res = run('/account/addresses');
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/signin?returnTo=%2Faccount%2Faddresses');
    expect(run('/account', 'ss_session=x').status).toBe(200);
  });
});
