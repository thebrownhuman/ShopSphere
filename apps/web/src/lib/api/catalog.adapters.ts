import type {
  CategoryNode as ApiCategoryNode,
  DeliveryEstimateResponse,
  Facet as ApiFacet,
  HomeResponse as ApiHomeResponse,
  ImageSet,
  OfferView,
  ProductCard,
  ProductDetailResponse,
  ProductOffersResponse,
  SearchResponse,
  SuggestResponse,
} from '@shopsphere/types';
import type {
  CategoryNode,
  DeliveryEstimate,
  Facet,
  HomeResponse,
  HomeSection,
  ImageRef,
  Offer,
  OffersResponse,
  ProductDetail,
  ProductSummary,
  QuadCard,
  SearchQuery,
  SearchResult,
  Suggestion,
} from './catalog.types';

/**
 * Backend DTOs (`@shopsphere/types` catalog contract) -> web view types. Pure functions so the
 * mapping is unit-tested without a server. `apiBase` resolves relative media URLs.
 */

/** Stock is reported as a status; IN_STOCK has no exact count, so cap at the order limit. */
const PLENTY = 999;

const abs = (url: string, apiBase: string) => (/^https?:\/\//.test(url) ? url : `${apiBase}${url}`);

export function toImage(
  set: ImageSet | null | undefined,
  apiBase: string,
  size: 'thumb' | 'small' | 'medium' | 'large' = 'medium',
  fallbackAlt = '',
): ImageRef | undefined {
  if (!set) return undefined;
  const px = { thumb: 100, small: 300, medium: 600, large: 1200 }[size];
  return {
    url: abs(set[size] || set.original, apiBase),
    alt: set.alt || fallbackAlt,
    width: px,
    height: px,
  };
}

function placeholderImage(label: string, apiBase: string): ImageRef {
  return {
    url: abs(`/media/ph/none.svg?label=${encodeURIComponent(label)}`, apiBase),
    alt: '',
    width: 600,
    height: 600,
  };
}

export function toSummary(c: ProductCard, apiBase: string): ProductSummary {
  return {
    id: c.productId,
    slug: c.slug,
    skuId: c.skuId,
    title: c.title,
    brand: c.brand,
    image: toImage(c.image, apiBase, 'medium', c.title) ?? placeholderImage(c.title, apiBase),
    rating: c.rating,
    ratingCount: c.ratingCount,
    price: c.pricing?.price ?? 0,
    mrp: c.pricing?.mrp ?? 0,
    plus: c.plus,
    inStock: c.inStock && !!c.pricing,
    sponsored: c.sponsored,
  };
}

export function toCategories(nodes: ApiCategoryNode[], apiBase: string): CategoryNode[] {
  return nodes.map((n) => ({
    id: n.id,
    slug: n.slug,
    name: n.name,
    image: n.image ? { url: abs(n.image, apiBase), alt: '', width: 200, height: 200 } : undefined,
    children: n.children.length ? toCategories(n.children, apiBase) : undefined,
  }));
}

/** Guests get a sign-in card in the fourth slot; the API has no audience field on quad cards. */
const GUEST_CARD: QuadCard = {
  id: 'guest-sign-in',
  title: 'Sign in for your best experience',
  tiles: [],
  cta: { label: 'Sign in securely', href: '/signin' },
  audience: 'guest',
};

export function toHome(res: ApiHomeResponse, apiBase: string): HomeResponse {
  const sorted = [...res.sections].sort((a, b) => a.position - b.position);
  const sections: HomeSection[] = sorted.map((s): HomeSection => {
    switch (s.type) {
      case 'HERO_CAROUSEL':
        return {
          id: s.id,
          type: 'hero',
          banners: s.banners.map((b) => ({
            id: b.id,
            title: b.title,
            subtitle: b.subtitle ?? '',
            href: b.href,
            image: { ...toImage(b.image, apiBase, 'large', b.title)!, width: 1500, height: 400 },
          })),
        };
      case 'QUAD_CARDS': {
        const cards: QuadCard[] = s.cards.map((c, i) => ({
          id: `${s.id}-${i}`,
          title: c.title,
          tiles: c.tiles.map((t) => ({
            label: t.title,
            href: t.href,
            image: toImage(t.image, apiBase, 'small'),
          })),
          cta: c.cta,
          audience: 'all',
        }));
        cards.splice(3, 0, GUEST_CARD);
        return { id: s.id, type: 'quad', cards };
      }
      case 'DEAL_ROW': {
        const ends = s.deals.map((d) => d.endsAt).sort()[0] ?? new Date().toISOString();
        return {
          id: s.id,
          type: 'deals',
          title: s.title,
          endsAt: ends,
          href: s.seeAllHref ?? '/s?discount=25',
          items: s.deals.map((d) => ({
            ...toSummary(d.product, apiBase),
            claimedPercent: d.claimedPercent,
          })),
        };
      }
      case 'PRODUCT_CAROUSEL':
        return {
          id: s.id,
          type: 'carousel',
          title: s.title,
          href: s.seeAllHref ?? undefined,
          items: s.products.map((p) => toSummary(p, apiBase)),
        };
      case 'RECENTLY_VIEWED':
        // ISR HTML is shared by everyone, so per-viewer history renders client-side.
        return { id: s.id, type: 'recently-viewed', title: s.title };
      case 'CATEGORY_TILES':
        return {
          id: s.id,
          type: 'category-tiles',
          title: s.title,
          categories: s.categories.map((c) => ({
            slug: c.slug,
            name: c.name,
            image: c.image
              ? { url: abs(c.image, apiBase), alt: '', width: 200, height: 200 }
              : undefined,
          })),
        };
    }
  });
  return { sections };
}

export function toProduct(p: ProductDetailResponse, apiBase: string): ProductDetail {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    brand: { name: p.brand.name, slug: p.brand.slug },
    categoryPath: p.breadcrumbs.map((c) => ({ slug: c.slug, name: c.name })),
    rating: p.rating,
    ratingCount: p.ratingCount,
    boughtLastMonth: p.boughtLastMonth,
    bullets: p.bullets,
    description: p.description,
    specs: p.specs.map((g) => ({ group: g.group, rows: g.items })),
    variantAxes: p.variantAttributes.map((a) => ({
      key: a.key,
      label: a.label,
      kind: a.options.some((o) => o.swatch) ? 'swatch' : 'chip',
      values: a.options.map((o) => ({ value: o.value, label: o.value, swatch: o.swatch })),
    })),
    skus: p.skus.map((s) => ({
      id: s.id,
      attributes: s.attributes,
      images: s.images.length
        ? s.images.map((i) => toImage(i, apiBase, 'medium', p.title)!)
        : [placeholderImage(p.title, apiBase)],
    })),
    defaultSkuId: p.selectedSkuId,
    returnPolicy: p.returnDays > 0 ? `${p.returnDays}-day replacement` : 'Non-returnable',
    countryOfOrigin: p.countryOfOrigin ?? 'India',
    alsoViewed: p.alsoViewed.map((c) => toSummary(c, apiBase)),
  };
}

function toOffer(o: OfferView): Offer {
  return {
    id: o.id,
    skuId: o.skuId,
    sellerId: o.seller.id,
    sellerName: o.seller.name,
    sellerRating: o.seller.rating,
    sellerAddress: o.seller.address,
    price: o.pricing.price,
    mrp: o.pricing.mrp,
    stockQty:
      o.stockStatus === 'OUT_OF_STOCK'
        ? 0
        : o.stockStatus === 'LOW_STOCK'
          ? (o.lowStockQty ?? 1)
          : PLENTY,
    maxPerOrder: o.maxPerOrder,
    fulfilment: o.fulfilment,
  };
}

export function toOffers(r: ProductOffersResponse): OffersResponse {
  const live = r.offers.filter((o) => o.stockStatus !== 'OUT_OF_STOCK').map(toOffer);
  const buyBox = live.find((o) => o.id === r.buyBoxOfferId) ?? null;
  return {
    productId: r.productId,
    skuId: r.skuId,
    buyBox,
    others: live.filter((o) => o !== buyBox),
    bankOffers: [],
  };
}

export function toDelivery(d: DeliveryEstimateResponse): DeliveryEstimate {
  return {
    skuId: d.skuId,
    pincode: d.pincode,
    serviceable: d.serviceable && !!d.deliveryDate,
    deliverBy: d.deliveryDate ?? '',
    free: d.freeDelivery,
    cutoffAt: d.cutoffAt ?? new Date().toISOString(),
  };
}

/** Site URL vocabulary -> API query (prices in paise, `plus`, `attr.<key>`). */
export function toSearchParams(q: SearchQuery, pageSize = 48): URLSearchParams {
  const p = new URLSearchParams();
  if (q.q) p.set('q', q.q);
  if (q.category) p.set('category', q.category);
  if (q.brand.length) p.set('brand', q.brand.join(','));
  if (q.priceMin !== undefined) p.set('minPrice', String(Math.round(q.priceMin * 100)));
  if (q.priceMax !== undefined) p.set('maxPrice', String(Math.round(q.priceMax * 100)));
  if (q.rating) p.set('rating', String(q.rating));
  if (q.discount) p.set('discount', String(q.discount));
  // `tomorrow` has no API filter yet; only Plus is forwarded.
  if (q.delivery === 'plus') p.set('plus', 'true');
  if (q.inStock) p.set('inStock', 'true');
  for (const [k, v] of Object.entries(q.attrs)) if (v.length) p.set(`attr.${k}`, v.join(','));
  if (q.sort !== 'featured') p.set('sort', q.sort);
  if (q.page > 1) p.set('page', String(q.page));
  p.set('pageSize', String(pageSize));
  return p;
}

function toFacet(f: ApiFacet): Facet | null {
  if (f.key === 'price' || f.key === 'availability' || f.key === 'inStock') return null; // price: slider from priceRange; stock: checkbox
  if (f.key === 'plus') {
    const yes = f.buckets.find((b) => b.value === 'true');
    return yes
      ? {
          key: 'delivery',
          label: 'Delivery',
          type: 'terms',
          values: [{ value: 'plus', label: 'ShopSphere Plus', count: yes.count }],
        }
      : null;
  }
  return {
    key: f.key.startsWith('attr.') ? f.key.slice(5) : f.key,
    label: f.label,
    type: 'terms',
    values: f.buckets.map((b) => ({ value: b.value, label: b.label, count: b.count })),
  };
}

export function toSearchResult(r: SearchResponse, apiBase: string): SearchResult {
  const facets = r.facets
    .map(toFacet)
    .filter((f): f is Facet => !!f && (f.type === 'range' || f.values.length > 0));
  if (r.priceRange) {
    const brandAt = facets.findIndex((f) => f.key === 'brand');
    facets.splice(brandAt + 1, 0, {
      key: 'price',
      label: 'Price',
      type: 'range',
      min: Math.floor(r.priceRange.min / 100),
      max: Math.ceil(r.priceRange.max / 100),
    });
  }
  return {
    total: r.total,
    page: r.page,
    pageSize: r.pageSize,
    items: r.results.map((c) => toSummary(c, apiBase)),
    facets,
    didYouMean: r.didYouMean ?? undefined,
    relatedCategories: r.relatedCategories.map((c) => ({ slug: c.slug, name: c.name })),
  };
}

export function toSuggestions(r: SuggestResponse): Suggestion[] {
  return r.suggestions.map((s) => ({
    kind: s.type,
    label: s.text,
    href:
      s.type === 'product' && s.slug
        ? `/p/${s.slug}`
        : s.type === 'category' && s.slug
          ? `/c/${s.slug}`
          : `/s?k=${encodeURIComponent(s.text)}`,
  }));
}
