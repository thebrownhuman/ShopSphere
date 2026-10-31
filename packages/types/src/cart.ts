import type { ImageSet, ProductCard } from './catalog';

/**
 * Cart, save-for-later and wishlist contract (M3). All money is integer paise and every total
 * is computed by the server: clients send SKU, seller and quantity, never prices.
 */

/** Why a line changed since it was added (PRD §7 banners). */
export interface CartPriceChange {
  /** Price when the line was added (snapshot). */
  from: number;
  /** Live price now. */
  to: number;
}

/** OUT_OF_STOCK: nothing left. LIMITED: fewer available than the line's qty. UNAVAILABLE: offer, SKU or seller gone. */
export type CartStockChange = 'OUT_OF_STOCK' | 'LIMITED' | 'UNAVAILABLE';

export interface CartLine {
  id: string;
  productId: string;
  skuId: string;
  sellerId: string;
  slug: string;
  title: string;
  /** Variant attributes, e.g. {"color":"Black"}. */
  variant: Record<string, string>;
  image: ImageSet | null;
  sellerName: string;
  /** SHOPSPHERE | SELLER */
  fulfilment: string;
  qty: number;
  /** Highest qty the shopper may pick now: min(stock, max per order, cart limit). 0 when unbuyable. */
  maxQty: number;
  /** Live unit price (0 when unavailable). */
  unitPrice: number;
  mrp: number;
  /** Unit price at add time. */
  snapshotPrice: number;
  /** unitPrice x purchasable qty. */
  lineTotal: number;
  inStock: boolean;
  /** Units available now (stock - reserved), never negative. */
  available: number;
  /** YYYY-MM-DD (IST) for the cart pincode, null if unserviceable. */
  deliveryDate: string | null;
  serviceable: boolean;
  priceChange: CartPriceChange | null;
  stockChange: CartStockChange | null;
  /** ISO 8601 UTC. */
  addedAt: string;
}

/** Lines grouped by seller + delivery date (PRD §7). */
export interface CartGroup {
  key: string;
  sellerId: string;
  sellerName: string;
  fulfilment: string;
  deliveryDate: string | null;
  lines: CartLine[];
}

export interface SavedItem {
  id: string;
  productId: string;
  skuId: string;
  sellerId: string;
  slug: string;
  title: string;
  variant: Record<string, string>;
  image: ImageSet | null;
  /** Live price, null when no longer buyable. */
  price: number | null;
  mrp: number | null;
  inStock: boolean;
  savedAt: string;
}

export interface CartSummary {
  /** Sum of purchasable quantities. */
  itemCount: number;
  lineCount: number;
  subtotal: number;
  mrpTotal: number;
  savings: number;
  deliveryFee: number;
  total: number;
  freeDeliveryThreshold: number;
  /** Paise still needed for free delivery; 0 once eligible. */
  freeDeliveryRemaining: number;
  freeDeliveryEligible: boolean;
  /** True when some line needs attention before checkout (unavailable, out of stock, too many). */
  hasIssues: boolean;
}

export interface CartLimits {
  maxLines: number;
  maxQtyPerItem: number;
}

export interface CartResponse {
  /** Null until the first item is added. */
  id: string | null;
  pincode: string;
  /** Bumped on every write; lets tabs detect they are stale. */
  version: number;
  groups: CartGroup[];
  saved: SavedItem[];
  summary: CartSummary;
  limits: CartLimits;
}

export interface AddToCartRequest {
  /** SKU id. */
  sku: string;
  /** Seller id; omitted = buy-box winner. */
  sellerId?: string;
  qty: number;
  /** Delivery pincode to validate against. */
  pincode?: string;
}

export interface AddToCartResponse {
  cart: CartResponse;
  lineId: string;
  /** Up to 3 add-on suggestions for the "Added to cart" drawer. */
  addOns: ProductCard[];
}

export interface UpdateCartItemRequest {
  qty: number;
  pincode?: string;
}

export interface WishlistItem {
  id: string;
  productId: string;
  skuId: string;
  slug: string;
  title: string;
  image: ImageSet | null;
  price: number | null;
  mrp: number | null;
  inStock: boolean;
  addedAt: string;
}

export interface WishlistResponse {
  items: WishlistItem[];
}

export interface AddToWishlistRequest {
  sku: string;
}

/** Cart error codes (ApiError.code). */
export type CartErrorCode =
  | 'SKU_UNAVAILABLE'
  | 'OFFER_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK'
  | 'QTY_LIMIT'
  | 'CART_FULL'
  | 'NOT_SERVICEABLE'
  | 'INVALID_PINCODE'
  | 'LINE_NOT_FOUND';
