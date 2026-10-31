import type { Facet, FacetBucket, SearchSort } from '@shopsphere/types';
import { z } from 'zod';

export const SEARCH_SORTS = ['featured', 'price_asc', 'price_desc', 'rating', 'newest'] as const;
export const DEFAULT_PAGE_SIZE = 48;
const MAX_RESULT_WINDOW = 10_000;

const csv = z
  .string()
  .optional()
  .transform((s) =>
    s
      ? s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [],
  );
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max).optional();
const flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const paramsSchema = z.object({
  q: z
    .string()
    .max(200)
    .optional()
    .transform((s) => (s ?? '').trim()),
  category: z.string().max(100).optional(),
  brand: csv,
  minPrice: int(0, 1e12),
  maxPrice: int(0, 1e12),
  rating: int(1, 5),
  discount: int(1, 100),
  plus: flag,
  inStock: flag,
  sort: z.enum(SEARCH_SORTS).default('featured'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

export interface SearchParams extends z.infer<typeof paramsSchema> {
  /** attr.<key>=v1,v2 */
  attrs: Record<string, string[]>;
}

/** Parses the raw query string; throws ZodError on invalid input. */
export function parseSearchParams(raw: Record<string, unknown>): SearchParams {
  const base = paramsSchema.parse(raw);
  const attrs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    const m = /^attr\.([a-z0-9_]{1,40})$/.exec(k);
    if (m && typeof v === 'string' && v) attrs[m[1]] = csv.parse(v);
  }
  return { ...base, attrs };
}

type Clause = Record<string, unknown>;

/** Every active filter keyed by its facet key, so each facet can exclude its own filter. */
export function filterClauses(p: SearchParams): Map<string, Clause> {
  const f = new Map<string, Clause>();
  if (p.category) f.set('category', { term: { categorySlugs: p.category } });
  if (p.brand.length) f.set('brand', { terms: { brandSlug: p.brand } });
  if (p.minPrice !== undefined || p.maxPrice !== undefined) {
    f.set('price', { range: { price: { gte: p.minPrice, lte: p.maxPrice } } });
  }
  if (p.rating) f.set('rating', { range: { rating: { gte: p.rating } } });
  if (p.discount) f.set('discount', { range: { discount: { gte: p.discount } } });
  if (p.plus) f.set('plus', { term: { plus: true } });
  if (p.inStock) f.set('inStock', { term: { inStock: true } });
  for (const [k, vals] of Object.entries(p.attrs)) {
    if (vals.length) f.set(`attr.${k}`, { terms: { attrKv: vals.map((v) => `${k}=${v}`) } });
  }
  return f;
}

function others(filters: Map<string, Clause>, except: string | string[]): Clause {
  const skip = new Set(Array.isArray(except) ? except : [except]);
  const keep = [...filters].filter(([k]) => !skip.has(k)).map(([, c]) => c);
  return { bool: { filter: keep } };
}

export const PRICE_BUCKETS: [number | undefined, number | undefined, string][] = [
  [undefined, 50_000, 'Under ₹500'],
  [50_000, 100_000, '₹500 – ₹1,000'],
  [100_000, 500_000, '₹1,000 – ₹5,000'],
  [500_000, 1_000_000, '₹5,000 – ₹10,000'],
  [1_000_000, 2_000_000, '₹10,000 – ₹20,000'],
  [2_000_000, undefined, 'Over ₹20,000'],
];
export const RATING_MINIMUMS = [4, 3, 2, 1];
export const DISCOUNT_MINIMUMS = [10, 25, 40, 50, 70];

export function textQuery(q: string): Clause {
  if (!q) return { match_all: {} };
  return {
    bool: {
      must: [
        {
          multi_match: {
            query: q,
            fields: ['title^4', 'brand^3', 'categoryNames^2', 'attrText'],
            type: 'best_fields',
            fuzziness: 'AUTO',
            prefix_length: 1,
            minimum_should_match: '2<75%',
          },
        },
      ],
      should: [
        { match_phrase: { title: { query: q, boost: 3 } } },
        { match: { 'brand.plain': { query: q, boost: 2 } } },
      ],
    },
  };
}

/**
 * Builds the _search body (M2.10). Ranking: text score × log1p(popularity) × ln(2 + rating)
 * × 2 when in stock. Filters go in post_filter; each facet aggregation applies all filters
 * except its own so counts stay useful for multi-select.
 */
export function buildSearchBody(p: SearchParams): Record<string, unknown> {
  const filters = filterClauses(p);
  const from = (p.page - 1) * p.pageSize;
  const sorts: Record<SearchSort, unknown[]> = {
    featured: ['_score', { salesRank: 'asc' }],
    price_asc: [{ price: { order: 'asc', missing: '_last' } }, '_score'],
    price_desc: [{ price: { order: 'desc', missing: '_last' } }, '_score'],
    rating: [{ rating: 'desc' }, { ratingCount: 'desc' }],
    newest: [{ createdAt: 'desc' }],
  };
  return {
    from,
    size: Math.max(0, Math.min(p.pageSize, MAX_RESULT_WINDOW - from)),
    track_total_hits: true,
    query: {
      function_score: {
        query: textQuery(p.q),
        functions: [
          { field_value_factor: { field: 'popularity', modifier: 'log1p', missing: 0.1 } },
          { field_value_factor: { field: 'rating', modifier: 'ln2p', missing: 0 } },
          { filter: { term: { inStock: true } }, weight: 2 },
        ],
        score_mode: 'multiply',
        boost_mode: 'multiply',
      },
    },
    post_filter: others(filters, []),
    sort: sorts[p.sort],
    aggs: {
      category: {
        filter: others(filters, 'category'),
        aggs: { v: { terms: { field: 'categoryKv', size: 20 } } },
      },
      brand: {
        filter: others(filters, 'brand'),
        aggs: { v: { terms: { field: 'brandKv', size: 30 } } },
      },
      price: {
        filter: others(filters, 'price'),
        aggs: {
          min: { min: { field: 'price' } },
          max: { max: { field: 'price' } },
          v: {
            range: {
              field: 'price',
              ranges: PRICE_BUCKETS.map(([from, to]) => ({ from, to })),
            },
          },
        },
      },
      rating: {
        filter: others(filters, 'rating'),
        aggs: {
          v: { range: { field: 'rating', ranges: RATING_MINIMUMS.map((r) => ({ from: r })) } },
        },
      },
      discount: {
        filter: others(filters, 'discount'),
        aggs: {
          v: { range: { field: 'discount', ranges: DISCOUNT_MINIMUMS.map((d) => ({ from: d })) } },
        },
      },
      plus: { filter: { bool: { filter: [others(filters, 'plus'), { term: { plus: true } }] } } },
      inStock: {
        filter: { bool: { filter: [others(filters, 'inStock'), { term: { inStock: true } }] } },
      },
      attrs: {
        filter: others(
          filters,
          Object.keys(p.attrs).map((k) => `attr.${k}`),
        ),
        aggs: { v: { terms: { field: 'attrKv', size: 300 } } },
      },
    },
    suggest: p.q
      ? {
          spell: {
            text: p.q,
            term: { field: 'title.plain', suggest_mode: 'popular', min_word_length: 3 },
          },
        }
      : undefined,
  };
}

interface TermsAgg {
  v: { buckets: { key: string; doc_count: number; from?: number; to?: number }[] };
}

export interface SearchAggs {
  category: TermsAgg;
  brand: TermsAgg;
  price: TermsAgg & { min: { value: number | null }; max: { value: number | null } };
  rating: TermsAgg;
  discount: TermsAgg;
  plus: { doc_count: number };
  inStock: { doc_count: number };
  attrs: TermsAgg;
}

const kvBuckets = (agg: TermsAgg): FacetBucket[] =>
  agg.v.buckets.map((b) => {
    const [value, label] = b.key.split('|');
    return { value, label: label ?? value, count: b.doc_count };
  });

/** OpenSearch returns range buckets sorted by `from`, so match on bounds, not position. */
function rangeCount(agg: TermsAgg, from: number | undefined, to: number | undefined): number {
  return agg.v.buckets.find((b) => b.from === from && b.to === to)?.doc_count ?? 0;
}

/**
 * Turns aggregations into facets. `attrLabels` maps attribute keys to display labels; only
 * keys present there are exposed (filterable attributes).
 */
export function parseFacets(aggs: SearchAggs, attrLabels: Map<string, string>): Facet[] {
  const facets: Facet[] = [
    { key: 'category', label: 'Category', type: 'terms', buckets: kvBuckets(aggs.category) },
    { key: 'brand', label: 'Brand', type: 'terms', buckets: kvBuckets(aggs.brand) },
    {
      key: 'price',
      label: 'Price',
      type: 'range',
      buckets: PRICE_BUCKETS.map(([from, to, label]) => ({
        value: `${from ?? ''}-${to ?? ''}`,
        label,
        count: rangeCount(aggs.price, from, to),
      })),
    },
    {
      key: 'rating',
      label: 'Customer rating',
      type: 'range',
      buckets: RATING_MINIMUMS.map((r) => ({
        value: String(r),
        label: `${r}★ & above`,
        count: rangeCount(aggs.rating, r, undefined),
      })),
    },
    {
      key: 'discount',
      label: 'Discount',
      type: 'range',
      buckets: DISCOUNT_MINIMUMS.map((d) => ({
        value: String(d),
        label: `${d}% or more`,
        count: rangeCount(aggs.discount, d, undefined),
      })),
    },
    {
      key: 'plus',
      label: 'Delivery',
      type: 'terms',
      buckets: [{ value: 'true', label: 'ShopSphere Plus', count: aggs.plus.doc_count }],
    },
    {
      key: 'inStock',
      label: 'Availability',
      type: 'terms',
      buckets: [{ value: 'true', label: 'In stock', count: aggs.inStock.doc_count }],
    },
  ];
  const byKey = new Map<string, FacetBucket[]>();
  for (const b of aggs.attrs.v.buckets) {
    const eq = b.key.indexOf('=');
    const k = b.key.slice(0, eq);
    if (!attrLabels.has(k)) continue;
    const v = b.key.slice(eq + 1);
    byKey.set(k, [...(byKey.get(k) ?? []), { value: v, label: v, count: b.doc_count }]);
  }
  for (const [k, buckets] of byKey) {
    facets.push({ key: `attr.${k}`, label: attrLabels.get(k)!, type: 'terms', buckets });
  }
  return facets;
}

interface SpellSuggest {
  spell?: { text: string; options: { text: string; freq: number }[] }[];
}

/** Rebuilds the query from per-term suggestions; null when nothing changes. */
export function didYouMean(q: string, suggest: SpellSuggest | undefined): string | null {
  const entries = suggest?.spell ?? [];
  let changed = false;
  const lower = q.toLowerCase();
  let out = lower;
  for (const e of entries) {
    const best = e.options[0];
    if (best && best.text !== e.text) {
      out = out.replace(e.text, best.text);
      changed = true;
    }
  }
  return changed && out !== lower ? out : null;
}

export function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim();
}
