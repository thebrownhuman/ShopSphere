import type { SearchQuery, SortKey } from './api/catalog.types';

/**
 * Listing state <-> URL. SEO-friendly and shareable (PRD §5: `/s?k=headphones&brand=sony&page=2`).
 * Multi-value filters are comma-separated; attribute filters use an `a_` prefix (`a_colour=black`).
 */

export const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'featured', label: 'Featured' },
  { value: 'price_asc', label: 'Price: Low to High' },
  { value: 'price_desc', label: 'Price: High to Low' },
  { value: 'rating', label: 'Avg. Customer Review' },
  { value: 'newest', label: 'Newest Arrivals' },
];

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function getter(params: Params) {
  if (params instanceof URLSearchParams) return (k: string) => params.get(k) ?? undefined;
  return (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
}

function keys(params: Params): string[] {
  return params instanceof URLSearchParams ? [...params.keys()] : Object.keys(params);
}

const list = (v?: string) => (v ? v.split(',').filter(Boolean) : []);
const num = (v?: string) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function parseSearchQuery(params: Params, base: Partial<SearchQuery> = {}): SearchQuery {
  const get = getter(params);
  const [min, max] = (get('price') ?? '').split('-');
  const sort = get('sort') as SortKey | undefined;
  const delivery = get('delivery');
  const attrs: Record<string, string[]> = {};
  for (const k of keys(params)) {
    if (k.startsWith('a_')) attrs[k.slice(2)] = list(get(k));
  }
  return {
    q: get('k')?.trim() || undefined,
    category: get('category') || base.category,
    brand: list(get('brand')),
    priceMin: num(min),
    priceMax: num(max),
    rating: num(get('rating')),
    discount: num(get('discount')),
    delivery: delivery === 'plus' || delivery === 'tomorrow' ? delivery : undefined,
    inStock: get('stock') === '1' || undefined,
    attrs,
    sort: SORTS.some((s) => s.value === sort) ? sort! : 'featured',
    page: Math.max(1, Math.floor(num(get('page')) ?? 1)),
  };
}

/** Canonical query string; keys in a fixed order so equal states produce equal URLs. */
export function serializeSearchQuery(q: SearchQuery, omitCategory = false): string {
  const p = new URLSearchParams();
  if (q.q) p.set('k', q.q);
  if (q.category && !omitCategory) p.set('category', q.category);
  if (q.brand.length) p.set('brand', q.brand.join(','));
  if (q.priceMin !== undefined || q.priceMax !== undefined) {
    p.set('price', `${q.priceMin ?? ''}-${q.priceMax ?? ''}`);
  }
  if (q.rating) p.set('rating', String(q.rating));
  if (q.discount) p.set('discount', String(q.discount));
  if (q.delivery) p.set('delivery', q.delivery);
  if (q.inStock) p.set('stock', '1');
  for (const k of Object.keys(q.attrs).sort()) {
    if (q.attrs[k]!.length) p.set(`a_${k}`, q.attrs[k]!.join(','));
  }
  if (q.sort !== 'featured') p.set('sort', q.sort);
  if (q.page > 1) p.set('page', String(q.page));
  return p.toString();
}

/** Toggle one value of a multi-select facet; any filter change resets to page 1. */
export function toggleFacet(q: SearchQuery, key: string, value: string): SearchQuery {
  const flip = (arr: string[]) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  if (key === 'brand') return { ...q, brand: flip(q.brand), page: 1 };
  return { ...q, attrs: { ...q.attrs, [key]: flip(q.attrs[key] ?? []) }, page: 1 };
}

export function activeFilterCount(q: SearchQuery): number {
  return (
    q.brand.length +
    Object.values(q.attrs).reduce((n, v) => n + v.length, 0) +
    (q.priceMin !== undefined || q.priceMax !== undefined ? 1 : 0) +
    (q.rating ? 1 : 0) +
    (q.discount ? 1 : 0) +
    (q.delivery ? 1 : 0) +
    (q.inStock ? 1 : 0)
  );
}

export function clearFilters(q: SearchQuery): SearchQuery {
  return { q: q.q, category: q.category, brand: [], attrs: {}, sort: q.sort, page: 1 };
}
