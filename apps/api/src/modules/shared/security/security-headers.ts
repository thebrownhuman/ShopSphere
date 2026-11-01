import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Response hardening for a JSON API (M7.1, ASVS V14.4). The API never serves HTML, so its CSP
 * forbids everything; browsers still honour frame-ancestors / nosniff on error pages.
 * HSTS is sent on every response: browsers ignore it over plain http (local dev), and TLS
 * terminates at the edge in production.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Permitted-Cross-Domain-Policies': 'none',
};

export function applySecurityHeaders(res: Response): void {
  res.removeHeader('X-Powered-By');
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) res.setHeader(k, v);
}

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    applySecurityHeaders(res);
    next();
  }
}
