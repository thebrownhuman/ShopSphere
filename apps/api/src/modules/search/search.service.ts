import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type {
  SearchClickRequest,
  SearchResponse,
  Suggestion,
  SuggestResponse,
} from '@shopsphere/types';
import { CategoryTreeService } from '../catalog/category-tree.service';
import { PrismaService } from '../shared/prisma/prisma.service';
import { OpenSearchClient } from './opensearch.client';
import { cardFromDoc, ProductDoc } from './product-document';
import {
  buildSearchBody,
  didYouMean,
  normalizeQuery,
  parseFacets,
  SearchAggs,
  SearchParams,
} from './search-query';

interface SearchHits {
  hits: { total: { value: number }; hits: { _source: ProductDoc }[] };
  aggregations: SearchAggs;
  suggest?: Parameters<typeof didYouMean>[1];
}

const LABEL_TTL_MS = 60_000;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private labels?: { at: number; map: Map<string, string> };

  constructor(
    private readonly os: OpenSearchClient,
    private readonly prisma: PrismaService,
    private readonly categories: CategoryTreeService,
  ) {}

  async search(p: SearchParams, ownerKey: string | null): Promise<SearchResponse> {
    const [res, labels] = await Promise.all([
      this.os.search<SearchHits>(buildSearchBody(p)),
      this.attributeLabels(),
    ]);
    const total = res.hits.total.value;
    const priceAgg = res.aggregations.price;
    const searchId = randomUUID();
    const relatedCategories = total === 0 ? await this.relatedCategories(p.q) : [];
    this.recordQuery(searchId, p.q, total, ownerKey);
    return {
      query: p.q,
      total,
      page: p.page,
      pageSize: p.pageSize,
      totalPages: Math.ceil(total / p.pageSize),
      sort: p.sort,
      results: res.hits.hits.map((h) => cardFromDoc(h._source)),
      facets: parseFacets(res.aggregations, labels),
      priceRange:
        priceAgg.min.value != null && priceAgg.max.value != null
          ? { min: priceAgg.min.value, max: priceAgg.max.value }
          : null,
      didYouMean: total < 5 ? didYouMean(p.q, res.suggest) : null,
      relatedCategories,
      searchId,
    };
  }

  /** Autocomplete (M2.11): popular past queries, matching products, matching categories. */
  async suggest(raw: string): Promise<SuggestResponse> {
    const q = normalizeQuery(raw).slice(0, 100);
    if (q.length < 2) return { query: q, suggestions: [] };
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [popular, products, { bySlug }] = await Promise.all([
      this.prisma.searchEvent.groupBy({
        by: ['normalized'],
        where: {
          type: 'QUERY',
          normalized: { startsWith: q },
          resultsCount: { gt: 0 },
          createdAt: { gte: since },
        },
        _count: { _all: true },
        orderBy: { _count: { normalized: 'desc' } },
        take: 4,
      }),
      this.os.search<{ hits: { hits: { _source: Pick<ProductDoc, 'slug' | 'title'> }[] } }>({
        size: 5,
        _source: ['slug', 'title'],
        query: {
          function_score: {
            query: {
              bool: {
                should: [
                  { match: { 'title.ac': { query: q, operator: 'and', boost: 2 } } },
                  { match: { title: { query: q, fuzziness: 'AUTO', prefix_length: 1 } } },
                ],
                minimum_should_match: 1,
              },
            },
            functions: [
              { field_value_factor: { field: 'popularity', modifier: 'log1p', missing: 0.1 } },
            ],
            boost_mode: 'multiply',
          },
        },
      }),
      this.categories.load(),
    ]);
    const suggestions: Suggestion[] = popular.map((p) => ({ type: 'query', text: p.normalized }));
    const cats = [...bySlug.values()]
      .filter(
        (c) =>
          c.name
            .toLowerCase()
            .split(/[\s&,]+/)
            .some((w) => w.startsWith(q)) || c.name.toLowerCase().startsWith(q),
      )
      .slice(0, 2);
    for (const c of cats) suggestions.push({ type: 'category', text: c.name, slug: c.slug });
    for (const h of products.hits.hits)
      suggestions.push({ type: 'product', text: h._source.title, slug: h._source.slug });
    return { query: q, suggestions };
  }

  async recordClick(body: SearchClickRequest, ownerKey: string | null): Promise<void> {
    const query = await this.prisma.searchEvent.findFirst({
      where: { searchId: body.searchId, type: 'QUERY' },
      select: { query: true, normalized: true },
    });
    await this.prisma.searchEvent.create({
      data: {
        type: 'CLICK',
        searchId: body.searchId,
        query: query?.query ?? '',
        normalized: query?.normalized ?? '',
        productId: body.productId,
        position: body.position,
        ownerKey,
      },
    });
  }

  /** Analytics write is fire-and-forget: search latency must not depend on it (M2.12). */
  private recordQuery(
    searchId: string,
    q: string,
    resultsCount: number,
    ownerKey: string | null,
  ): void {
    if (!q) return;
    this.prisma.searchEvent
      .create({
        data: {
          type: 'QUERY',
          searchId,
          query: q,
          normalized: normalizeQuery(q),
          resultsCount,
          ownerKey,
        },
      })
      .catch((err: unknown) =>
        this.logger.warn({ err: String(err) }, 'search analytics write failed'),
      );
  }

  private async relatedCategories(q: string) {
    const { byId } = await this.categories.load();
    const words = normalizeQuery(q)
      .split(' ')
      .filter((w) => w.length >= 3);
    const all = [...byId.values()];
    const hits = all.filter((c) => words.some((w) => c.name.toLowerCase().includes(w.slice(0, 4))));
    return (hits.length ? hits : all.filter((c) => c.depth === 0))
      .slice(0, 6)
      .map(({ id, slug, name }) => ({ id, slug, name }));
  }

  private async attributeLabels(): Promise<Map<string, string>> {
    if (this.labels && Date.now() - this.labels.at < LABEL_TTL_MS) return this.labels.map;
    const defs = await this.prisma.attributeDefinition.findMany({
      where: { filterable: true },
      select: { key: true, label: true },
      distinct: ['key'],
    });
    this.labels = { at: Date.now(), map: new Map(defs.map((d) => [d.key, d.label])) };
    return this.labels.map;
  }
}
