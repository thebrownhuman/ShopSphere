import { Inject, Injectable } from '@nestjs/common';
import { CATALOG_CONFIG, CatalogConfig } from '../catalog/catalog.config';

export class OpenSearchError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`OpenSearch ${status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
}

/** Minimal OpenSearch REST client over fetch; enough for index admin, bulk and _search. */
@Injectable()
export class OpenSearchClient {
  constructor(@Inject(CATALOG_CONFIG) private readonly cfg: CatalogConfig) {}

  get index(): string {
    return this.cfg.SEARCH_INDEX;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    opts: { ndjson?: boolean; allow404?: boolean } = {},
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.cfg.OPENSEARCH_URL}${path}`, {
      method,
      headers: { 'content-type': opts.ndjson ? 'application/x-ndjson' : 'application/json' },
      body: body === undefined ? undefined : opts.ndjson ? (body as string) : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const parsed = (text ? JSON.parse(text) : null) as T;
    if (!res.ok && !(opts.allow404 && res.status === 404))
      throw new OpenSearchError(res.status, parsed);
    return { status: res.status, body: parsed };
  }

  async search<T = unknown>(body: unknown): Promise<T> {
    return (await this.request<T>('POST', `/${this.index}/_search`, body)).body;
  }

  /** Bulk with `{index|delete}` actions; throws if any item failed. */
  async bulk(lines: unknown[], refresh = false): Promise<void> {
    if (lines.length === 0) return;
    const ndjson = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
    const { body } = await this.request<{
      errors: boolean;
      items: Record<string, { error?: unknown; status: number }>[];
    }>('POST', `/_bulk${refresh ? '?refresh=true' : ''}`, ndjson, { ndjson: true });
    if (body.errors) {
      const failed = body.items
        .map((i) => Object.values(i)[0])
        .filter((i) => i.error && i.status !== 404)
        .slice(0, 3);
      if (failed.length > 0) throw new OpenSearchError(207, failed);
    }
  }
}
