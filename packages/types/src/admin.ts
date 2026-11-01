import type { Paise } from './index';
import type { HomeSectionType } from './catalog';

// ───────── Admin console (M6.5) ─────────

export const STAFF_ROLES = ['SUPER_ADMIN', 'CATALOG', 'SUPPORT', 'FINANCE'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface AdminMe {
  id: string;
  name: string | null;
  email: string | null;
  roles: StaffRole[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  roles: StaffRole[];
  createdAt: string;
}

export type UserStatus = 'active' | 'suspended';

export interface AdminSellerRow {
  id: string;
  name: string;
  slug: string;
  city: string;
  state: string;
  isFirstParty: boolean;
  status: string;
}

export interface AdminProductRow {
  id: string;
  slug: string;
  title: string;
  brand: string;
  category: string;
  status: 'ACTIVE' | 'DRAFT' | 'BLOCKED' | string;
  updatedAt: string;
}

export interface AdminOrderRow {
  id: string;
  number: string;
  userId: string;
  status: string;
  paymentMethod: string;
  totalPaise: Paise;
  placedAt: string;
}

export interface AdminRefundView {
  id: string;
  amountPaise: Paise;
  status: string;
  reason: string;
  createdAt: string;
}

export interface AdminOrderDetail extends AdminOrderRow {
  payablePaise: Paise;
  couponCode: string | null;
  customer: { name: string | null; email: string | null; phone: string | null };
  items: { title: string; qty: number; unitPricePaise: Paise; sellerId: string }[];
  events: { toStatus: string; type: string; actor: string; createdAt: string }[];
  capturedPaise: Paise;
  refundedPaise: Paise;
  refunds: AdminRefundView[];
}

export interface ManualRefundRequest {
  amountPaise: Paise;
  note: string;
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
}

// ───────── Promotions (M6.6) ─────────

export interface AdminCoupon {
  id: string;
  code: string;
  description: string;
  type: 'FLAT' | 'PERCENT';
  /** Paise (FLAT) or basis points (PERCENT). */
  value: number;
  minOrderPaise: Paise;
  maxDiscountPaise: Paise | null;
  perUserLimit: number;
  totalLimit: number | null;
  usedCount: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
}

export type CouponInput = Omit<AdminCoupon, 'id' | 'usedCount'>;

export interface LightningDealView {
  id: string;
  offerId: string;
  skuId: string;
  productId: string;
  title: string;
  dealPricePaise: Paise;
  quantityCap: number;
  claimedQty: number;
  /** 0–100, floor(claimed / cap). */
  claimedPercent: number;
  startsAt: string;
  endsAt: string;
  active: boolean;
}

export interface DealOfferOption {
  offerId: string;
  productId: string;
  skuId: string;
  sellerId: string;
  title: string;
  sellerName: string;
  pricePaise: Paise;
  mrpPaise: Paise;
  availableQty: number;
}

export interface LightningDealInput {
  offerId: string;
  title?: string;
  dealPricePaise: Paise;
  quantityCap: number;
  startsAt: string;
  endsAt: string;
  active?: boolean;
}

export interface BankOfferView {
  id: string;
  title: string;
  provider: 'bank';
  percentBp: number;
  maxDiscountPaise: Paise | null;
  minOrderPaise: Paise;
  startsAt: string;
  endsAt: string;
  active: boolean;
}

export type BankOfferInput = Omit<BankOfferView, 'id' | 'provider'>;

/** Bank offer applied to a checkout (only when paying via the ShopSphere Bank provider). */
export interface AppliedBankOffer {
  id: string;
  title: string;
  discountPaise: Paise;
}

// ───────── Home CMS (M6.7) ─────────

export type HomeAudience = 'ALL' | 'GUEST' | 'SIGNED_IN';

export interface AdminHomeSection {
  id: string;
  type: HomeSectionType;
  title: string;
  /** Type-specific JSON (banners, query, cards, `lightningDeals: true` …). */
  dataSource: Record<string, unknown>;
  position: number;
  audience: HomeAudience;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export type HomeSectionInput = Omit<AdminHomeSection, 'id' | 'position'>;

// ───────── Fraud review queue (M7.2) ─────────

export type FraudDecision = 'ALLOW' | 'FORCE_PREPAID' | 'MANUAL_REVIEW' | 'CHALLENGE';
export type FraudReviewStatus = 'NONE' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface FraudSignalView {
  code: string;
  points: number;
  detail: string;
}

export interface FraudAssessmentView {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  userId: string;
  score: number;
  decision: FraudDecision;
  signals: FraudSignalView[];
  paymentMethod: string;
  totalPaise: Paise;
  ip: string | null;
  deviceId: string | null;
  reviewStatus: FraudReviewStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export interface FraudThresholdsView {
  forcePrepaidScore: number;
  reviewScore: number;
  captchaScore: number;
  highValuePaise: Paise;
  newAccountDays: number;
  userOrdersPerHour: number;
  deviceOrdersPerHour: number;
  deviceUsersPerDay: number;
  ipOrdersPerHour: number;
}
