/**
 * Local view types for the catalog/search API (plan §8: GET /home, /categories, /products/:slug,
 * /products/:id/offers, /delivery-estimate, /search, /search/suggest).
 * Reconcile with `@shopsphere/types` catalog DTOs when the backend lands; keep every money field
 * in integer paise.
 */

export interface ImageRef {
  url: string;
  alt: string;
  width: number;
  height: number;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  image?: ImageRef;
  children?: CategoryNode[];
}

export interface CategoryCrumb {
  slug: string;
  name: string;
}

/** Search-index projection of a product, enough to draw a tile. */
export interface ProductSummary {
  id: string;
  slug: string;
  skuId: string;
  title: string;
  brand: string;
  image: ImageRef;
  rating: number;
  ratingCount: number;
  /** 0 when there is no live offer (the tile then hides the price). */
  price: number;
  mrp: number;
  /** "Fulfilled by ShopSphere" fast delivery (PRD "Plus" badge). */
  plus: boolean;
  inStock: boolean;
  /** Fastest delivery in days from today, when the source knows it (the API card does not). */
  deliveryDays?: number;
  sponsored?: boolean;
}

// ---------- /home ----------

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  image: ImageRef;
}

export interface QuadCard {
  id: string;
  title: string;
  tiles: Array<{ label: string; href: string; image?: ImageRef }>;
  cta: { label: string; href: string } | null;
  /** `guest` cards only render for signed-out shoppers. */
  audience: 'all' | 'guest' | 'signed-in';
}

export interface DealItem extends ProductSummary {
  claimedPercent: number;
}

export type HomeSection =
  | { id: string; type: 'hero'; banners: Banner[] }
  | { id: string; type: 'quad'; cards: QuadCard[] }
  | { id: string; type: 'deals'; title: string; endsAt: string; href: string; items: DealItem[] }
  | { id: string; type: 'carousel'; title: string; href?: string; items: ProductSummary[] }
  | { id: string; type: 'recently-viewed'; title: string }
  | {
      id: string;
      type: 'category-tiles';
      title: string;
      categories: Array<{ slug: string; name: string; image?: ImageRef }>;
    };

export interface HomeResponse {
  sections: HomeSection[];
}

// ---------- /products/:slug ----------

export interface VariantAxis {
  /** Attribute key on each SKU, e.g. `colour`, `size`. */
  key: string;
  label: string;
  kind: 'swatch' | 'chip';
  values: Array<{ value: string; label: string; swatch?: string }>;
}

export interface Sku {
  id: string;
  attributes: Record<string, string>;
  images: ImageRef[];
}

export interface SpecGroup {
  group: string;
  rows: Array<{ label: string; value: string }>;
}

export interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  brand: { name: string; slug: string };
  categoryPath: CategoryCrumb[];
  rating: number;
  ratingCount: number;
  boughtLastMonth: number;
  bullets: string[];
  description: string;
  specs: SpecGroup[];
  variantAxes: VariantAxis[];
  skus: Sku[];
  defaultSkuId: string;
  returnPolicy: string;
  /** Consumer Protection (E-Commerce) Rules 2020: shown on the PDP. */
  countryOfOrigin: string;
  /** "Customers who viewed this also viewed" (co-view counts, v1). */
  alsoViewed: ProductSummary[];
}

// ---------- /products/:id/offers  (always live, never cached) ----------

export interface Offer {
  id: string;
  skuId: string;
  sellerId: string;
  sellerName: string;
  sellerRating: number;
  /** "City, State - PIN"; absent in older responses. */
  sellerAddress?: string;
  price: number;
  mrp: number;
  stockQty: number;
  maxPerOrder: number;
  fulfilment: 'SHOPSPHERE' | 'SELLER';
}

export interface OffersResponse {
  productId: string;
  skuId: string;
  /** Buy-box winner; null when no seller has stock. */
  buyBox: Offer | null;
  others: Offer[];
  bankOffers: string[];
}

// ---------- /delivery-estimate ----------

export interface DeliveryEstimate {
  skuId: string;
  pincode: string;
  serviceable: boolean;
  /** ISO date (YYYY-MM-DD) of earliest delivery. */
  deliverBy: string;
  free: boolean;
  /** ISO timestamp: order before this to get `deliverBy`. */
  cutoffAt: string;
}

// ---------- /search ----------

export type SortKey = 'featured' | 'price_asc' | 'price_desc' | 'rating' | 'newest';

export interface SearchQuery {
  q?: string;
  category?: string;
  brand: string[];
  /** Rupee bounds (URL-friendly); converted to paise by the API. */
  priceMin?: number;
  priceMax?: number;
  rating?: number;
  discount?: number;
  delivery?: 'plus' | 'tomorrow';
  inStock?: boolean;
  /** Category-specific attributes, e.g. { colour: ['black'] }. */
  attrs: Record<string, string[]>;
  sort: SortKey;
  page: number;
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export type Facet =
  | { key: string; label: string; type: 'terms'; values: FacetValue[] }
  | { key: 'price'; label: string; type: 'range'; min: number; max: number };

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  items: ProductSummary[];
  facets: Facet[];
  didYouMean?: string;
  relatedCategories: CategoryCrumb[];
}

export interface Suggestion {
  kind: 'query' | 'category' | 'product';
  label: string;
  href: string;
}
