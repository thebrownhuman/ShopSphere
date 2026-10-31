import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../shared/errors/app-error';

/** Catalog/search env, parsed apart from the shared schema (same pattern as payment.config). */
export const catalogEnvSchema = z.object({
  OPENSEARCH_URL: z.string().url().default('http://localhost:9200'),
  SEARCH_INDEX: z.string().min(1).default('products'),
  /** Public base for absolute media URLs (placeholder images are served by this API). */
  API_URL: z.string().url().default('http://localhost:4000'),
  /** CDN / S3 base for processed renditions (M2.3). */
  MEDIA_BASE_URL: z.string().url().default('http://localhost:8333/catalog'),
  /** Worker -> API internal calls (indexer, image pipeline). */
  CATALOG_INTERNAL_TOKEN: z.string().min(16).default('dev-internal-token-change-me'),
});

export type CatalogConfig = z.infer<typeof catalogEnvSchema>;
export const CATALOG_CONFIG = Symbol('CATALOG_CONFIG');

export function loadCatalogConfig(raw: Record<string, string | undefined>): CatalogConfig {
  const result = catalogEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid catalog environment: ${issues}`);
  }
  if (raw.NODE_ENV === 'production' && raw.CATALOG_INTERNAL_TOKEN === undefined) {
    throw new Error(
      'Invalid catalog environment: CATALOG_INTERNAL_TOKEN must be set in production',
    );
  }
  return result.data;
}

/** Guards worker-only routes with `x-internal-token`. */
@Injectable()
export class CatalogInternalGuard implements CanActivate {
  constructor(@Inject(CATALOG_CONFIG) private readonly cfg: CatalogConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(
      ctx.switchToHttp().getRequest<Request>().header('x-internal-token') ?? '',
    );
    const expected = Buffer.from(this.cfg.CATALOG_INTERNAL_TOKEN);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new AppError('UNAUTHORIZED', 'Internal token required', HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
