/**
 * Catalog, search, delivery and home DTOs (M2). API contract shared by apps/api and apps/web.
 * Keep changes additive: new optional fields only.
 * Money is always integer paise. Dates are ISO 8601 UTC strings.
 */

type Paise = number;

// ───────── Shared building blocks ─────────

export interface ImageSet {
  /** Alt text, always present. */
  alt: string;
  /** URLs keyed by width bucket. `original` always present. */
  thumb: string; // 100px
  small: string; // 300px
  medium: string; // 600px
  large: string; // 1200px
  original: string;
}

export interface PriceInfo {
  /** Selling price, GST inclusive. */
  price: Paise;
  mrp: Paise;
  /** Whole percent, floor((mrp - price) / mrp * 100). 0 when no discount. */
  discountPercent: number;
  /** GST rate in percent applied for the category, e.g. 18. */
  gstRatePercent: number;
  /** GST portion included in `price`. */
  gstAmount: Paise;
  /** Always true for B2C display: "Inclusive of all taxes". */
  taxInclusive: true;
}

export type FulfilmentType = 'SHOPSPHERE' | 'SELLER';

export interface SellerSummary {
  id: string;
  name: string;
  /** 0–5, one decimal. */
  rating: number;
  /** True for ShopSphere's own warehouses (1P). */
  isFirstParty: boolean;
  /** Registered dispatch address, "City, State - PIN" (Consumer Protection (E-Commerce) Rules). */
  address?: string;
}

/** Product tile used by search results, home carousels, recently viewed, also-viewed. */
export interface ProductCard {
  productId: string;
  /** Default (buy-box) SKU id. */
  skuId: string;
  slug: string;
  title: string;
  brand: string;
  image: ImageSet | null;
  /** 0–5, one decimal. */
  rating: number;
  ratingCount: number;
  /** Null when no live offer (out of stock everywhere). */
  pricing: PriceInfo | null;
  inStock: boolean;
  /** Fulfilled by ShopSphere ("Plus" badge). */
  plus: boolean;
  /** Present on search results that are paid placements. */
  sponsored?: boolean;
}

// ───────── Categories ─────────

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  /** Materialized path of slugs, e.g. "electronics/audio/headphones". */
  path: string;
  depth: number;
  image: string | null;
  children: CategoryNode[];
}

/** GET /categories */
export interface CategoriesResponse {
  categories: CategoryNode[];
}

export interface CategoryCrumb {
  id: string;
  slug: string;
  name: string;
}

// ───────── Product detail ─────────

export interface VariantAttributeOption {
  value: string;
  /** Hex colour for swatches when the attribute is colour-like. */
  swatch?: string;
  /** False when every SKU with this value is out of stock. */
  available: boolean;
}

export interface VariantAttribute {
  /** Attribute key, e.g. "color", "storage". */
  key: string;
  label: string;
  options: VariantAttributeOption[];
}

export interface SkuDetail {
  id: string;
  /** e.g. { color: "Black", storage: "128 GB" } */
  attributes: Record<string, string>;
  images: ImageSet[];
  /** Buy-box winner for this SKU; null when no live offer. */
  buyBox: OfferView | null;
  /** Number of other live offers besides the buy-box. */
  otherOfferCount: number;
  /** Lowest price among other offers, null when none. */
  otherOffersFrom: Paise | null;
}

export interface SpecGroup {
  group: string;
  items: { label: string; value: string }[];
}

/** GET /products/:slug  (optional ?sku= selects the variant) */
export interface ProductDetailResponse {
  id: string;
  slug: string;
  title: string;
  brand: { id: string; slug: string; name: string };
  breadcrumbs: CategoryCrumb[];
  description: string;
  bullets: string[];
  specs: SpecGroup[];
  rating: number;
  ratingCount: number;
  /** e.g. 1200 → "1K+ bought in past month". */
  boughtLastMonth: number;
  /** Replacement / return window in days. */
  returnDays: number;
  /** Consumer Protection (E-Commerce) Rules 2020. */
  countryOfOrigin?: string;
  variantAttributes: VariantAttribute[];
  skus: SkuDetail[];
  /** SKU selected by ?sku or the default variant. */
  selectedSkuId: string;
  /** "Customers who viewed this also viewed" (co-view, M2.21). */
  alsoViewed: ProductCard[];
}

// ───────── Offers ─────────

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface OfferView {
  id: string;
  skuId: string;
  seller: SellerSummary;
  pricing: PriceInfo;
  fulfilment: FulfilmentType;
  stockStatus: StockStatus;
  /** Only set when LOW_STOCK ("Only 3 left"). */
  lowStockQty?: number;
  maxPerOrder: number;
  /** Fastest SLA in days from the seller's location, before pincode is known. */
  baseSlaDays: number;
}

/** GET /products/:id/offers?sku= */
export interface ProductOffersResponse {
  productId: string;
  skuId: string;
  /** Id of the buy-box winner, null when no live offer. */
  buyBoxOfferId: string | null;
  /** All live offers, buy-box first, then by price. */
  offers: OfferView[];
}

// ───────── Delivery estimate ─────────

export type DeliveryZone = 'LOCAL' | 'REGIONAL' | 'METRO' | 'NATIONAL' | 'REMOTE';

/** GET /delivery-estimate?sku&pincode[&offerId] */
export interface DeliveryEstimateResponse {
  skuId: string;
  pincode: string;
  serviceable: boolean;
  /** City / state for "Deliver to" display; null when pincode unknown. */
  city: string | null;
  state: string | null;
  zone: DeliveryZone | null;
  /** Earliest delivery date, YYYY-MM-DD in IST; null when not serviceable. */
  deliveryDate: string | null;
  slaDays: number | null;
  /** Order before this instant (ISO UTC) to get `deliveryDate`; null when not serviceable. */
  cutoffAt: string | null;
  /** Seconds until cutoff at response time, for the countdown. */
  cutoffSecondsRemaining: number | null;
  freeDelivery: boolean;
  /** Delivery fee when not free. */
  deliveryFee: Paise;
  offerId: string | null;
}

// ───────── Search ─────────

export type SearchSort = 'featured' | 'price_asc' | 'price_desc' | 'rating' | 'newest';

export interface FacetBucket {
  value: string;
  label: string;
  count: number;
}

export interface Facet {
  /** Filter key as used in the query string: category, brand, rating, discount, price, plus, availability, or attr.<key>. */
  key: string;
  label: string;
  type: 'terms' | 'range';
  buckets: FacetBucket[];
}

/**
 * GET /search?q&category&brand&minPrice&maxPrice&rating&discount&plus&inStock&attr.<key>&sort&page&pageSize
 * Multi-value filters are comma separated: brand=sony,boat. Prices in paise. rating/discount are minimums.
 */
export interface SearchResponse {
  query: string;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: SearchSort;
  results: ProductCard[];
  facets: Facet[];
  /** Price range (paise) across matches, for the slider. */
  priceRange: { min: Paise; max: Paise } | null;
  /** "Did you mean" when results are few. */
  didYouMean: string | null;
  /** Category suggestions for no-results view. */
  relatedCategories: CategoryCrumb[];
  /** Opaque id to send back with click analytics. */
  searchId: string;
}

export type SuggestionType = 'query' | 'product' | 'category';

export interface Suggestion {
  type: SuggestionType;
  text: string;
  /** For product: product slug; for category: category slug. */
  slug?: string;
}

/** GET /search/suggest?q */
export interface SuggestResponse {
  query: string;
  suggestions: Suggestion[];
}

/** POST /search/click body (analytics, M2.12). */
export interface SearchClickRequest {
  searchId: string;
  productId: string;
  position: number;
}

// ───────── Home ─────────

export type HomeSectionType =
  | 'HERO_CAROUSEL'
  | 'QUAD_CARDS'
  | 'DEAL_ROW'
  | 'PRODUCT_CAROUSEL'
  | 'RECENTLY_VIEWED'
  | 'CATEGORY_TILES';

export interface Banner {
  id: string;
  title: string;
  subtitle: string | null;
  image: ImageSet;
  /** Relative URL, e.g. "/s?k=headphones&brand=sony". */
  href: string;
}

export interface QuadTile {
  title: string;
  image: ImageSet | null;
  href: string;
}

export interface QuadCard {
  title: string;
  tiles: QuadTile[];
  cta: { label: string; href: string } | null;
}

export interface DealItem {
  product: ProductCard;
  /** ISO UTC, deal end for the countdown. */
  endsAt: string;
  /** 0–100. */
  claimedPercent: number;
}

interface HomeSectionBase {
  id: string;
  title: string;
  /** Lower first. */
  position: number;
}

export type HomeSection =
  | (HomeSectionBase & { type: 'HERO_CAROUSEL'; banners: Banner[] })
  | (HomeSectionBase & { type: 'QUAD_CARDS'; cards: QuadCard[] })
  | (HomeSectionBase & { type: 'DEAL_ROW'; deals: DealItem[]; seeAllHref: string | null })
  | (HomeSectionBase & {
      type: 'PRODUCT_CAROUSEL';
      products: ProductCard[];
      seeAllHref: string | null;
    })
  | (HomeSectionBase & { type: 'RECENTLY_VIEWED'; products: ProductCard[] })
  | (HomeSectionBase & {
      type: 'CATEGORY_TILES';
      categories: (CategoryCrumb & { image: string | null })[];
    });

/** GET /home  (signed-in users get history-based rows; guests send X-Guest-Id for recently viewed) */
export interface HomeResponse {
  sections: HomeSection[];
}

// ───────── Recently viewed (M2.21) ─────────

/** POST /recently-viewed body. Guests identify with the X-Guest-Id header. */
export interface RecordViewRequest {
  productId: string;
}

/** GET /recently-viewed */
export interface RecentlyViewedResponse {
  products: ProductCard[];
}
