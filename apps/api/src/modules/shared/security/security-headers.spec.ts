import type { Response } from 'express';
import { API_SECURITY_HEADERS, SecurityHeadersMiddleware } from './security-headers';

describe('SecurityHeadersMiddleware', () => {
  it('sets HSTS, CSP, nosniff, frame denial and drops X-Powered-By', () => {
    const headers = new Map<string, string>([['X-Powered-By', 'Express']]);
    const res = {
      setHeader: (k: string, v: string) => headers.set(k, v),
      removeHeader: (k: string) => headers.delete(k),
    } as unknown as Response;
    const next = jest.fn();
    new SecurityHeadersMiddleware().use({} as never, res, next);
    expect(next).toHaveBeenCalled();
    expect(headers.has('X-Powered-By')).toBe(false);
    expect(headers.get('Strict-Transport-Security')).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(Object.keys(API_SECURITY_HEADERS).length).toBeGreaterThanOrEqual(8);
  });
});
