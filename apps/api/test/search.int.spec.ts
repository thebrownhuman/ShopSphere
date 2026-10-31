/**
 * Search integration test against a real OpenSearch (docker-compose `opensearch`, default
 * http://localhost:9200). Run with `pnpm --filter @shopsphere/api test:int`.
 * Builds a throwaway index from fixtures, exercises the production query builder and mapping.
 */
import type { ProductCard } from '@shopsphere/types';
import { loadCatalogConfig } from '../src/modules/catalog/catalog.config';
import type { CategoryRow } from '../src/modules/catalog/category-tree.service';
import { productIndexBody } from '../src/modules/search/index-mapping';
import { OpenSearchClient } from '../src/modules/search/opensearch.client';
import { buildProductDoc, cardFromDoc, ProductDoc } from '../src/modules/search/product-document';
import {
  buildSearchBody,
  didYouMean,
  parseFacets,
  parseSearchParams,
  SearchAggs,
} from '../src/modules/search/search-query';

const index = `products_it_${Date.now()}`;
const os = new OpenSearchClient(
  loadCatalogConfig({
    OPENSEARCH_URL: process.env.OPENSEARCH_URL ?? 'http://localhost:9200',
    SEARCH_INDEX: index,
  }),
);

const cat = (
  id: string,
  slug: string,
  name: string,
  parentId: string | null = null,
): CategoryRow => ({
  id,
  slug,
  name,
  parentId,
  path: slug,
  depth: parentId ? 1 : 0,
  position: 0,
  gstRateBp: null,
  image: null,
});
const electronics = cat('c-el', 'electronics', 'Electronics');
const headphones = cat('c-hp', 'headphones', 'Headphones', 'c-el');
const tvs = cat('c-tv', 'televisions', 'Televisions', 'c-el');
const fashion = cat('c-fa', 'fashion', 'Fashion');
const shirts = cat('c-ts', 'mens-tshirts', "Men's T-Shirts", 'c-fa');

let seq = 0;
function doc(
  title: string,
  brand: string,
  chain: CategoryRow[],
  price: number,
  mrp: number,
  extra: Partial<{
    rating: number;
    color: string;
    anc: string;
    inStock: boolean;
    plus: boolean;
    rank: number;
  }> = {},
): ProductDoc {
  seq++;
  const card: ProductCard = {
    productId: `p${seq}`,
    skuId: `s${seq}`,
    slug: `p-${seq}`,
    title,
    brand,
    image: null,
    rating: extra.rating ?? 4,
    ratingCount: 100,
    pricing: {
      price,
      mrp,
      discountPercent: Math.floor(((mrp - price) * 100) / mrp),
      gstRatePercent: 18,
      gstAmount: 0,
      taxInclusive: true,
    },
    inStock: extra.inStock ?? true,
    plus: extra.plus ?? false,
  };
  return buildProductDoc({
    card,
    brandSlug: brand.toLowerCase(),
    chain,
    gstBp: 1800,
    skuAttributes: [{ color: extra.color ?? 'Black' }],
    filterableSpecs: extra.anc ? { anc: extra.anc } : {},
    salesRank: extra.rank ?? seq * 10,
    sellerIds: ['seller-1'],
    createdAt: new Date(Date.UTC(2026, 0, seq)),
  });
}

const DOCS = [
  doc('Sonora Pro Wireless Headphones', 'Sonora', [headphones, electronics], 299_900, 499_900, {
    color: 'Black',
    anc: 'Active',
    plus: true,
    rank: 1,
  }),
  doc('Sonora Lite On-Ear Headphones', 'Sonora', [headphones, electronics], 99_900, 149_900, {
    color: 'Blue',
    anc: 'Passive',
    rank: 5,
  }),
  doc(
    'BassLine Max Noise Cancelling Headphones',
    'BassLine',
    [headphones, electronics],
    1_499_900,
    1_999_900,
    { color: 'White', anc: 'Active', rating: 4.6 },
  ),
  doc('BassLine Gaming Headset', 'BassLine', [headphones, electronics], 249_900, 249_900, {
    color: 'Black',
    inStock: false,
  }),
  doc(
    'Auralis Studio Over-Ear Headphones',
    'Auralis',
    [headphones, electronics],
    699_900,
    999_900,
    { color: 'Silver', rating: 3.2 },
  ),
  doc('Vistra 55 inch 4K Smart Television', 'Vistra', [tvs, electronics], 4_499_900, 6_999_900, {
    rank: 2,
  }),
  doc('Lumina 43 inch Full HD Smart LED', 'Lumina', [tvs, electronics], 2_299_900, 2_999_900),
  doc('Urbanloom Cotton Round Neck T-Shirt', 'Urbanloom', [shirts, fashion], 49_900, 99_900, {
    color: 'Navy',
  }),
];

async function run(raw: Record<string, string>) {
  const p = parseSearchParams(raw);
  const res = await os.search<{
    hits: { total: { value: number }; hits: { _source: ProductDoc }[] };
    aggregations: SearchAggs;
    suggest?: Parameters<typeof didYouMean>[1];
  }>(buildSearchBody(p));
  return {
    total: res.hits.total.value,
    titles: res.hits.hits.map((h) => h._source.title),
    cards: res.hits.hits.map((h) => cardFromDoc(h._source)),
    facets: parseFacets(
      res.aggregations,
      new Map([
        ['color', 'Colour'],
        ['anc', 'Noise Cancellation'],
      ]),
    ),
    didYouMean: didYouMean(p.q, res.suggest),
  };
}

const facet = (r: Awaited<ReturnType<typeof run>>, key: string) =>
  Object.fromEntries(
    (r.facets.find((f) => f.key === key)?.buckets ?? []).map((b) => [b.value, b.count]),
  );

beforeAll(async () => {
  await os.request('PUT', `/${index}`, productIndexBody);
  await os.bulk(
    DOCS.flatMap((d) => [{ index: { _index: index, _id: d.productId } }, d]),
    true,
  );
}, 60_000);

afterAll(async () => {
  await os.request('DELETE', `/${index}`, undefined, { allow404: true });
});

describe('search against OpenSearch', () => {
  it('matches text and ranks in-stock, popular items first', async () => {
    const r = await run({ q: 'headphones' });
    expect(r.total).toBe(5);
    expect(r.titles[0]).toBe('Sonora Pro Wireless Headphones');
    expect(r.titles[r.titles.length - 1]).toBe('BassLine Gaming Headset'); // out of stock sinks
  });

  it('tolerates typos', async () => {
    const r = await run({ q: 'hedphones sonra' });
    expect(r.titles).toEqual(
      expect.arrayContaining(['Sonora Pro Wireless Headphones', 'Sonora Lite On-Ear Headphones']),
    );
  });

  it('expands synonyms (tv = television, Hinglish tshirt)', async () => {
    expect((await run({ q: 'tv' })).titles).toContain('Vistra 55 inch 4K Smart Television');
    expect((await run({ q: 'tee' })).titles).toEqual(['Urbanloom Cotton Round Neck T-Shirt']);
  });

  it('suggests a spelling for zero-result queries', async () => {
    const r = await run({ q: 'televisoin' });
    expect(r.didYouMean).toBe('television');
  });

  it('filters by brand, price and parent category; facets exclude their own filter', async () => {
    const r = await run({ category: 'electronics', brand: 'sonora', maxPrice: '260000' });
    expect(r.titles).toEqual(['Sonora Lite On-Ear Headphones']);
    // Brand facet ignores the brand filter (multi-select) but keeps category + price.
    expect(facet(r, 'brand')).toEqual({ sonora: 1, bassline: 1 });
    expect(facet(r, 'category')).toEqual({ headphones: 1 });
    expect(r.cards[0].pricing).toMatchObject({ price: 99_900, mrp: 149_900, discountPercent: 33 });
  });

  it('returns attribute, rating, discount, plus and availability facets', async () => {
    const r = await run({ category: 'headphones' });
    expect(facet(r, 'attr.color')).toEqual({ Black: 2, Blue: 1, White: 1, Silver: 1 });
    expect(facet(r, 'attr.anc')).toEqual({ Active: 2, Passive: 1 });
    expect(facet(r, 'rating')['4']).toBe(4);
    expect(facet(r, 'discount')['25']).toBe(4);
    expect(facet(r, 'plus')).toEqual({ true: 1 });
    expect(facet(r, 'inStock')).toEqual({ true: 4 });
  });

  it('filters by attributes, rating, discount, plus and stock', async () => {
    expect((await run({ 'attr.anc': 'Active' })).total).toBe(2);
    expect(
      (await run({ 'attr.color': 'Black,Blue', inStock: 'true', category: 'headphones' })).total,
    ).toBe(2);
    expect((await run({ rating: '4', category: 'headphones' })).total).toBe(4);
    expect((await run({ discount: '40' })).titles).toEqual(
      expect.arrayContaining([
        'Sonora Pro Wireless Headphones',
        'Urbanloom Cotton Round Neck T-Shirt',
      ]),
    );
    expect((await run({ plus: 'true' })).titles).toEqual(['Sonora Pro Wireless Headphones']);
  });

  it('sorts by price and newest, and paginates', async () => {
    const asc = await run({ category: 'headphones', sort: 'price_asc' });
    expect(asc.cards.map((c) => c.pricing!.price)).toEqual([
      99_900, 249_900, 299_900, 699_900, 1_499_900,
    ]);
    const newest = await run({ sort: 'newest', pageSize: '1' });
    expect(newest.titles).toEqual(['Urbanloom Cotton Round Neck T-Shirt']);
    const page2 = await run({
      category: 'headphones',
      sort: 'price_asc',
      pageSize: '2',
      page: '2',
    });
    expect(page2.cards.map((c) => c.pricing!.price)).toEqual([299_900, 699_900]);
  });

  it('autocompletes on edge n-grams', async () => {
    const res = await os.search<{ hits: { hits: { _source: ProductDoc }[] } }>({
      query: { match: { 'title.ac': { query: 'bassl gam', operator: 'and' } } },
    });
    expect(res.hits.hits.map((h) => h._source.title)).toEqual(['BassLine Gaming Headset']);
  });
});
