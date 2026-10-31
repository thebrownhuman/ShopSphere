import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SpecGroup } from '@shopsphere/types';
import Redis from 'ioredis';
import { CATALOG_EVENTS } from '../catalog/catalog-events';
import { CategoryTreeService } from '../catalog/category-tree.service';
import { LoadedProduct, PRODUCT_INCLUDE, ProductLoader } from '../catalog/product-loader';
import { PrismaService } from '../shared/prisma/prisma.service';
import { REDIS } from '../shared/redis/redis.module';
import { productIndexBody } from './index-mapping';
import { OpenSearchClient } from './opensearch.client';
import { buildProductDoc, ProductDoc } from './product-document';

export const INDEXER_CONSUMER = 'search-indexer';
/** Stock-only changes reindex a product at most once per window (M2.9). */
export const STOCK_DEBOUNCE_MS = 60_000;
const PENDING_SET = 'search:stock-pending';
const debounceKey = (productId: string) => `search:stock-debounce:${productId}`;
const BATCH = 250;

interface OutboxRow {
  id: string;
  event_type: string;
  payload: { productId?: string; stockOnly?: boolean };
}

export interface IndexRunSummary {
  events: number;
  indexed: number;
  deferred: number;
}

@Injectable()
export class SearchIndexerService {
  private readonly logger = new Logger(SearchIndexerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly os: OpenSearchClient,
    private readonly loader: ProductLoader,
    private readonly categories: CategoryTreeService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async ensureIndex(recreate = false): Promise<void> {
    const path = `/${this.os.index}`;
    if (recreate) await this.os.request('DELETE', path, undefined, { allow404: true });
    const { status } = await this.os.request('HEAD', path, undefined, { allow404: true });
    if (status === 404) await this.os.request('PUT', path, productIndexBody);
  }

  /** Full rebuild: drop, recreate, bulk-load every active product. */
  async reindexAll(): Promise<{ indexed: number }> {
    await this.ensureIndex(true);
    this.categories.invalidate();
    const labels = await this.filterableLabels();
    let cursor: string | undefined;
    let indexed = 0;
    for (;;) {
      const rows = await this.prisma.product.findMany({
        where: { status: 'ACTIVE' },
        include: PRODUCT_INCLUDE,
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      const docs: ProductDoc[] = [];
      for (const row of rows)
        if (row.skus.length) docs.push(await this.toDoc(await this.loader.enrich(row), labels));
      await this.os.bulk(
        docs.flatMap((d) => [{ index: { _index: this.os.index, _id: d.productId } }, d]),
      );
      indexed += docs.length;
    }
    await this.os.request('POST', `/${this.os.index}/_refresh`);
    return { indexed };
  }

  /** Reindexes the given products; missing/inactive ones are removed from the index. */
  async indexProducts(ids: string[], refresh = false): Promise<number> {
    if (ids.length === 0) return 0;
    const loaded = await this.loader.loadMany(ids);
    const labels = await this.filterableLabels();
    const present = new Set(loaded.map((p) => p.row.id));
    const lines: unknown[] = [];
    for (const p of loaded) {
      const doc = await this.toDoc(p, labels);
      lines.push({ index: { _index: this.os.index, _id: doc.productId } }, doc);
    }
    for (const id of ids)
      if (!present.has(id)) lines.push({ delete: { _index: this.os.index, _id: id } });
    await this.os.bulk(lines, refresh);
    return loaded.length;
  }

  /**
   * Consumes catalog outbox events (M2.9). Content/price changes reindex immediately;
   * stock-only changes are debounced per product and flushed on a later run.
   */
  async processPending(limit = 500, refresh = false): Promise<IndexRunSummary> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      SELECT e.id, e.event_type, e.payload FROM outbox_events e
      WHERE e.event_type = ANY(${[...CATALOG_EVENTS]}::text[])
        AND NOT EXISTS (
          SELECT 1 FROM processed_events p WHERE p.consumer = ${INDEXER_CONSUMER} AND p.event_id = e.id::text)
      ORDER BY e.created_at
      LIMIT ${limit}`;
    const now = new Set<string>();
    let deferred = 0;
    for (const r of rows) {
      const id = r.payload.productId;
      if (!id) continue;
      if (!r.payload.stockOnly) {
        now.add(id);
        continue;
      }
      const acquired = await this.redis.set(debounceKey(id), '1', 'PX', STOCK_DEBOUNCE_MS, 'NX');
      if (acquired) now.add(id);
      else {
        await this.redis.sadd(PENDING_SET, id);
        deferred++;
      }
    }
    for (const id of await this.redis.smembers(PENDING_SET)) {
      if (now.has(id) || !(await this.redis.exists(debounceKey(id)))) {
        await this.redis.set(debounceKey(id), '1', 'PX', STOCK_DEBOUNCE_MS);
        await this.redis.srem(PENDING_SET, id);
        now.add(id);
      }
    }
    const indexed = await this.indexProducts([...now], refresh);
    if (rows.length) {
      await this.prisma.processedEvent.createMany({
        data: rows.map((r) => ({ consumer: INDEXER_CONSUMER, eventId: r.id })),
        skipDuplicates: true,
      });
    }
    if (rows.length || indexed)
      this.logger.log({ events: rows.length, indexed, deferred }, 'index run');
    return { events: rows.length, indexed, deferred };
  }

  private async toDoc(p: LoadedProduct, labels: Map<string, string>): Promise<ProductDoc> {
    const chain = await this.categories.chain(p.row.categoryId);
    const filterableSpecs: Record<string, string> = {};
    for (const g of (p.row.specs as unknown as SpecGroup[]) ?? []) {
      for (const item of g.items ?? []) {
        const key = labels.get(item.label.toLowerCase());
        if (key) filterableSpecs[key] = item.value;
      }
    }
    const sellers = new Set<string>();
    for (const s of p.skus) for (const o of s.ranked) sellers.add(o.sellerId);
    return buildProductDoc({
      card: this.loader.card(p),
      brandSlug: p.row.brand.slug,
      chain,
      gstBp: p.gstBp,
      skuAttributes: p.row.skus.map((s) => s.attributes as Record<string, string>),
      filterableSpecs,
      salesRank: p.row.salesRank,
      sellerIds: [...sellers],
      createdAt: p.row.createdAt,
    });
  }

  /** lowercased label → key for filterable attributes (spec rows are matched by label). */
  private async filterableLabels(): Promise<Map<string, string>> {
    const defs = await this.prisma.attributeDefinition.findMany({
      where: { filterable: true },
      select: { key: true, label: true },
    });
    return new Map(defs.map((d) => [d.label.toLowerCase(), d.key]));
  }
}
