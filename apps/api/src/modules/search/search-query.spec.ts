/* eslint-disable @typescript-eslint/no-explicit-any -- tests poke into loosely typed OpenSearch DSL */
import {
  buildSearchBody,
  didYouMean,
  filterClauses,
  parseFacets,
  parseSearchParams,
  SearchAggs,
} from './search-query';

describe('parseSearchParams', () => {
  it('applies defaults and splits multi-value filters', () => {
    const p = parseSearchParams({
      q: '  Headphones ',
      brand: 'sony, boat,',
      'attr.color': 'Black,Blue',
      'attr.BAD KEY': 'x',
    });
    expect(p).toMatchObject({
      q: 'Headphones',
      brand: ['sony', 'boat'],
      sort: 'featured',
      page: 1,
      pageSize: 48,
    });
    expect(p.attrs).toEqual({ color: ['Black', 'Blue'] });
  });

  it('rejects invalid sort and out-of-range values', () => {
    expect(() => parseSearchParams({ sort: 'cheapest' })).toThrow();
    expect(() => parseSearchParams({ rating: '6' })).toThrow();
    expect(() => parseSearchParams({ pageSize: '500' })).toThrow();
  });
});

describe('buildSearchBody', () => {
  const p = parseSearchParams({
    q: 'tv',
    brand: 'vistra',
    minPrice: '100000',
    plus: 'true',
    'attr.screen': '55 inch',
    page: '3',
    pageSize: '10',
  });
  const body = buildSearchBody(p) as Record<string, any>;

  it('paginates and keeps every filter in post_filter', () => {
    expect(body.from).toBe(20);
    expect(body.size).toBe(10);
    expect(body.post_filter.bool.filter).toHaveLength(4);
  });

  it('excludes each facet own filter from its aggregation', () => {
    const brandFilters = JSON.stringify(body.aggs.brand.filter);
    expect(brandFilters).not.toContain('brandSlug');
    expect(brandFilters).toContain('"plus":true');
    expect(JSON.stringify(body.aggs.attrs.filter)).not.toContain('screen=');
    expect(JSON.stringify(body.aggs.price.filter)).not.toContain('"price"');
  });

  it('ranks by text × popularity × rating × stock and asks for spelling', () => {
    const fs = body.query.function_score;
    expect(fs.boost_mode).toBe('multiply');
    expect(fs.functions).toHaveLength(3);
    expect(fs.query.bool.must[0].multi_match.fuzziness).toBe('AUTO');
    expect(body.suggest.spell.text).toBe('tv');
  });

  it('uses match_all without a query and maps sorts', () => {
    const b = buildSearchBody(parseSearchParams({ sort: 'price_desc' })) as Record<string, any>;
    expect(b.query.function_score.query).toEqual({ match_all: {} });
    expect(b.sort[0]).toEqual({ price: { order: 'desc', missing: '_last' } });
    expect(b.suggest).toBeUndefined();
  });

  it('builds no filters for empty params', () => {
    expect(filterClauses(parseSearchParams({})).size).toBe(0);
  });
});

describe('parseFacets', () => {
  const terms = (keys: [string, number][]) => ({
    v: { buckets: keys.map(([key, doc_count]) => ({ key, doc_count })) },
  });
  const aggs: SearchAggs = {
    category: terms([['headphones|Headphones', 5]]),
    brand: terms([['sonora|Sonora', 3]]),
    price: {
      min: { value: 100 },
      max: { value: 900 },
      // OpenSearch orders range buckets by `from`, not by request order.
      v: {
        buckets: [
          { key: '*-50000', to: 50_000, doc_count: 2 },
          { key: '2000000-*', from: 2_000_000, doc_count: 1 },
        ],
      },
    },
    rating: {
      v: { buckets: [1, 2, 3, 4].map((r) => ({ key: `${r}-*`, from: r, doc_count: 10 - r })) },
    },
    discount: { v: { buckets: [{ key: '10-*', from: 10, doc_count: 4 }] } },
    plus: { doc_count: 2 },
    inStock: { doc_count: 4 },
    attrs: terms([
      ['color=Black', 3],
      ['color=Blue', 1],
      ['secret=x', 9],
    ]),
  };

  it('labels kv buckets, matches ranges by bound and hides non-filterable attributes', () => {
    const facets = parseFacets(aggs, new Map([['color', 'Colour']]));
    const get = (k: string) => facets.find((f) => f.key === k)!;
    expect(get('brand').buckets).toEqual([{ value: 'sonora', label: 'Sonora', count: 3 }]);
    expect(get('rating').buckets[0]).toEqual({ value: '4', label: '4★ & above', count: 6 });
    expect(get('price').buckets[0]).toMatchObject({ value: '-50000', count: 2 });
    expect(get('price').buckets[5]).toMatchObject({ value: '2000000-', count: 1 });
    expect(get('discount').buckets.find((b) => b.value === '25')!.count).toBe(0);
    expect(get('attr.color')).toMatchObject({
      label: 'Colour',
      buckets: [
        { value: 'Black', count: 3 },
        { value: 'Blue', count: 1 },
      ],
    });
    expect(facets.some((f) => f.key === 'attr.secret')).toBe(false);
  });
});

describe('didYouMean', () => {
  it('rebuilds the query from term suggestions', () => {
    expect(
      didYouMean('Hedphones sony', {
        spell: [
          { text: 'hedphones', options: [{ text: 'headphones', freq: 9 }] },
          { text: 'sony', options: [] },
        ],
      }),
    ).toBe('headphones sony');
    expect(didYouMean('sony', { spell: [{ text: 'sony', options: [] }] })).toBeNull();
    expect(didYouMean('x', undefined)).toBeNull();
  });
});
