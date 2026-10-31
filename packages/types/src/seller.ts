/**
 * Seller Central DTOs (M5.1–M5.4, M5.8). API contract shared by apps/api and apps/seller.
 * Money is integer paise. Dates are ISO 8601 UTC strings.
 *
 * Seller routes (all need `Authorization: Bearer <access token>`; a seller is a user with a
 * seller account):
 *   GET   /seller/me                         → SellerAccountView | 404 SELLER_NOT_FOUND
 *   POST  /seller/register   SellerRegisterRequest   → SellerAccountView
 *   PATCH /seller/kyc        SellerKycRequest        → SellerAccountView (DRAFT / REJECTED only)
 *   POST  /seller/kyc/bank   BankVerifyRequest       → SellerAccountView (simulated penny drop)
 *   POST  /seller/kyc/submit                         → SellerAccountView (status SUBMITTED)
 * Approved sellers only (else 403 SELLER_NOT_APPROVED):
 *   GET   /seller/categories                 → SellerCategory[] (leaf categories)
 *   GET   /seller/categories/:id/attributes  → SellerAttribute[] (own + inherited)
 *   POST  /seller/media      MediaUploadRequest      → MediaUploadResponse
 *   POST  /seller/listings   ListingRequest          → ListingCreated
 *   GET   /seller/inventory?q&cursor&limit           → InventoryPage
 *   PATCH /seller/offers/:id OfferPatch              → InventoryRow
 *   GET   /seller/listings/bulk/template.csv?categoryId → CSV template
 *   POST  /seller/listings/bulk  BulkUploadRequest   → BulkReport
 *   GET   /seller/dashboard                          → SellerDashboard
 * Admin approval queue (`x-internal-token`, until the admin console lands in M6):
 *   GET   /seller/admin/applications?status=SUBMITTED → SellerAccountView[]
 *   POST  /seller/admin/applications/:id/approve      → SellerAccountView
 *   POST  /seller/admin/applications/:id/reject {reason} → SellerAccountView
 *
 * Error codes: SELLER_NOT_FOUND, SELLER_EXISTS, SELLER_NOT_APPROVED, KYC_INVALID (details:
 * KycIssue[]), KYC_LOCKED, BANK_VERIFY_FAILED, LISTING_INVALID (details: issues), SKU_EXISTS,
 * OFFER_NOT_FOUND, OFFER_INVALID, UPLOAD_INVALID, VALIDATION_FAILED.
 */

type Paise = number;

export type SellerStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface PickupAddress {
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface SellerAccountView {
  id: string;
  status: SellerStatus;
  displayName: string;
  legalName: string | null;
  isFirstParty: boolean;
  pan: string | null;
  gstin: string | null;
  bank: {
    holderName: string;
    accountLast4: string;
    ifsc: string;
    verified: boolean;
    /** Name the bank returned on the penny drop. */
    nameAtBank: string | null;
  } | null;
  pickup: PickupAddress | null;
  /** Seller id used on offers/orders once approved. */
  sellerId: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Fields still missing before KYC can be submitted. */
  missing: string[];
}

export interface SellerRegisterRequest {
  displayName: string;
}

export interface SellerKycRequest {
  legalName?: string;
  pan?: string;
  gstin?: string;
  pickup?: PickupAddress;
}

export interface BankVerifyRequest {
  holderName: string;
  accountNumber: string;
  ifsc: string;
}

export interface KycIssue {
  field: string;
  message: string;
}

// ───────── Listings ─────────

export interface SellerCategory {
  id: string;
  name: string;
  /** "Electronics › Audio › Headphones" */
  pathLabel: string;
  path: string;
}

export interface SellerAttribute {
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'COLOR';
  isVariant: boolean;
}

export interface MediaUploadRequest {
  fileName: string;
  /** image/png | image/jpeg | image/webp */
  contentType: string;
  /** Base64 file body, max 2 MB decoded. */
  dataBase64: string;
}

export interface MediaUploadResponse {
  id: string;
  url: string;
}

export interface ListingVariant {
  /** Variant attribute values, e.g. {"color":"Black"}; empty for single-SKU products. */
  attributes: Record<string, string>;
  skuCode?: string;
  price: Paise;
  mrp: Paise;
  stock: number;
  /** Uploaded media ids or http(s) URLs. */
  images?: string[];
}

export interface ListingRequest {
  categoryId: string;
  title: string;
  brand: string;
  description?: string;
  bullets?: string[];
  /** Non-variant attribute values, shown as specifications. */
  specs?: Record<string, string>;
  images?: string[];
  variants: ListingVariant[];
}

export interface ListingCreated {
  productId: string;
  slug: string;
  skus: { skuId: string; code: string; offerId: string }[];
}

// ───────── Inventory ─────────

export interface InventoryRow {
  offerId: string;
  skuId: string;
  skuCode: string;
  productId: string;
  productSlug: string;
  title: string;
  attributes: Record<string, string>;
  price: Paise;
  mrp: Paise;
  stock: number;
  reserved: number;
  status: 'ACTIVE' | 'INACTIVE';
  updatedAt: string;
}

export interface InventoryPage {
  rows: InventoryRow[];
  nextCursor: string | null;
}

export interface OfferPatch {
  price?: Paise;
  mrp?: Paise;
  stock?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

// ───────── Bulk listing ─────────

export interface BulkUploadRequest {
  fileName: string;
  /** Base64 CSV or XLSX body, max 5 MB decoded, max 1000 rows. */
  dataBase64: string;
  /** Validate only; create nothing. */
  dryRun?: boolean;
}

export interface BulkRowResult {
  /** 1-based data row number (header excluded) as the seller sees it in the sheet. */
  row: number;
  status: 'OK' | 'ERROR' | 'SKIPPED';
  errors: { column: string; message: string }[];
  skuCode: string | null;
}

export interface BulkReport {
  fileName: string;
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  errorRows: number;
  productsCreated: number;
  skusCreated: number;
  rows: BulkRowResult[];
}

// ───────── Dashboard ─────────

export interface SellerDashboard {
  /** Last 30 days, confirmed-or-later order lines. */
  sales: { last30DaysPaise: Paise; unitsLast30Days: number; todayPaise: Paise };
  orders: { total: number; byStatus: Record<string, number> };
  returns: { requested: number; completed: number };
  listings: { activeOffers: number; outOfStock: number };
  /** Null until the settlement engine (M5.7) produces payout data. */
  payouts: { pendingPaise: Paise; paidPaise: Paise; lastPayoutAt: string | null } | null;
  daily: { date: string; salesPaise: Paise; orders: number }[];
}
