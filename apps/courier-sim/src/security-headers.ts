import type { NextFunction, Request, Response } from 'express';

/**
 * Response hardening (M7.1, ASVS V14.4). JSON + PDF labels only: nothing may run or frame.
 */
const HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.removeHeader('X-Powered-By');
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  next();
}
