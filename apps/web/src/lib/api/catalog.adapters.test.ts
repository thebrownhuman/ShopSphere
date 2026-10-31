import type { OfferView, ProductCard, SearchResponse } from '@shopsphere/types';
import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '../search-params';
import { toHome, toOffers, toSearchParams, toSearchResult, toSummary } from './catalog.adapters';

const API = 'http://api.test';
const pricing = (price: number, mrp: number) => ({
  price,
  mrp,
  discountPercent: 0,
  gstRatePercent: 18,
  gstAmount: 0,
  taxInclusive: true as const,
});
const card: ProductCard = {
  productId: 'p1',
  skuId: 's1',
  slug: 'sony-x',
  title: 'Sony X',
  brand: 'Sony',
  image: {
    alt: 'Sony X',
    thumb: '/t',
    small: '/s',
    medium: '/media/ph/a.svg',
    large: '/l',
    original: '/o',
  },
  rating: 4.2,
  ratingCount: 10,
  pricing: pricing(99900, 129900),
  inStock: true,
  plus: true,
};
const offer = (id: string, status: OfferView['stockStatus'], low?: number): OfferView => ({
  id,
  skuId: 's1',
  seller: { id: 'sel', name: 'Seller', rating: 4.5, isFirstParty: false },
  pricing: pricing(1000, 2000),
  fulfilment: 'SELLER',
  stockStatus: status,
  lowStockQty: low,
  maxPerOrder: 5,
  baseSlaDays: 2,
});

describe('catalog adapters', () => {
  it('maps a product card, resolving relative media and missing pricing', () => {
    const s = toSummary(card, API);
    expect(s).toMatchObject({ id: 'p1', price: 99900, mrp: 129900, inStock: true });
    expect(s.image.url).toBe('http://api.test/media/ph/a.svg');
    expect(s.deliveryDays).toBeUndefined();
    expect(toSummary({ ...card, pricing: null }, API)).toMatchObject({ price: 0, inStock: false });
  });

  it('splits offers into buy box and others, converting stock status', () => {
    const r = toOffers({
      productId: 'p1',
      skuId: 's1',
      buyBoxOfferId: 'b',
      offers: [offer('b', 'LOW_STOCK', 3), offer('o', 'IN_STOCK'), offer('x', 'OUT_OF_STOCK')],
    });
    expect(r.buyBox).toMatchObject({ id: 'b', stockQty: 3 });
    expect(r.others.map((o) => o.id)).toEqual(['o']);
    expect(
      toOffers({ productId: 'p', skuId: 's', buyBoxOfferId: null, offers: [] }).buyBox,
    ).toBeNull();
  });

  it('translates site URL filters to API params (paise, plus, attr.)', () => {
    const q = parseSearchQuery(
      new URLSearchParams(
        'k=tv&brand=sony,lg&price=1000-5000&delivery=plus&stock=1&a_color=Black&page=2',
      ),
    );
    expect(Object.fromEntries(toSearchParams(q))).toEqual({
      q: 'tv',
      brand: 'sony,lg',
      minPrice: '100000',
      maxPrice: '500000',
      plus: 'true',
      inStock: 'true',
      'attr.color': 'Black',
      page: '2',
      pageSize: '48',
    });
  });

  it('maps facets and price range from the search response', () => {
    const res: SearchResponse = {
      query: 'tv',
      total: 1,
      page: 1,
      pageSize: 48,
      totalPages: 1,
      sort: 'featured',
      results: [card],
      facets: [
        {
          key: 'brand',
          label: 'Brand',
          type: 'terms',
          buckets: [{ value: 'sony', label: 'Sony', count: 1 }],
        },
        { key: 'price', label: 'Price', type: 'range', buckets: [] },
        {
          key: 'plus',
          label: 'Plus',
          type: 'terms',
          buckets: [{ value: 'true', label: 'Plus', count: 1 }],
        },
        {
          key: 'inStock',
          label: 'Stock',
          type: 'terms',
          buckets: [{ value: 'true', label: 'In', count: 1 }],
        },
        {
          key: 'attr.color',
          label: 'Colour',
          type: 'terms',
          buckets: [{ value: 'Black', label: 'Black', count: 1 }],
        },
      ],
      priceRange: { min: 99950, max: 500000 },
      didYouMean: null,
      relatedCategories: [],
      searchId: 'x',
    };
    const r = toSearchResult(res, API);
    expect(r.facets.map((f) => f.key)).toEqual(['brand', 'price', 'delivery', 'color']);
    expect(r.facets[1]).toMatchObject({ type: 'range', min: 999, max: 5000 });
    expect(r.didYouMean).toBeUndefined();
  });

  it('orders home sections and injects the guest card in the fourth slot', () => {
    const quad = (title: string) => ({ title, tiles: [], cta: null });
    const home = toHome(
      {
        sections: [
          {
            id: 'q',
            type: 'QUAD_CARDS',
            title: 'Q',
            position: 2,
            cards: ['a', 'b', 'c', 'd'].map(quad),
          },
          { id: 'r', type: 'RECENTLY_VIEWED', title: 'Recent', position: 9, products: [] },
          {
            id: 'c',
            type: 'PRODUCT_CAROUSEL',
            title: 'Top',
            position: 1,
            products: [card],
            seeAllHref: null,
          },
        ],
      },
      API,
    );
    expect(home.sections.map((s) => s.type)).toEqual(['carousel', 'quad', 'recently-viewed']);
    const q = home.sections[1];
    expect(q?.type === 'quad' && q.cards.map((c) => c.audience)).toEqual([
      'all',
      'all',
      'all',
      'guest',
      'all',
    ]);
  });
});
