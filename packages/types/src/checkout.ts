/**
 * Checkout API contract (M4.3–M4.9, M4.12, M4.19, M4.20). All money is integer paise; all prices
 * are GST-inclusive and computed by the server. Keep changes additive.
 *
 *   POST  /checkout                          CreateCheckoutRequest   -> CheckoutSession (201)
 *   GET   /checkout/:id                                              -> CheckoutSession
 *   PATCH /checkout/:id                      UpdateCheckoutRequest   -> CheckoutSession
 *   POST  /checkout/:id/place-order          PlaceOrderRequest       -> PlaceOrderResponse (201)
 *         (header Idempotency-Key required; repeating the call returns the same order)
 *   POST  /payments/:orderId/initiate        InitiatePaymentRequest  -> InitiatePaymentResponse
 *         (header Idempotency-Key required)
 *
 * Every route needs `Authorization: Bearer <access token>` (guests sign in first, PRD §8 step 1).
 */

import type { AppliedBankOffer } from './admin';
import type { Paise } from './index';
import type { OrderStatus } from './order';

// ───────── Session ─────────

export type CheckoutSource = 'CART' | 'BUY_NOW';

/** OPEN until placed or 30 minutes after the last change. */
export type CheckoutStatus = 'OPEN' | 'PLACED' | 'EXPIRED';

export type CreateCheckoutRequest =
  | { source: 'CART'; addressId?: string }
  | {
      source: 'BUY_NOW';
      skuId: string;
      /** Defaults to the buy-box winner. */
      sellerId?: string;
      qty: number;
      addressId?: string;
    };

export type DeliveryOptionType = 'STANDARD' | 'ONE_DAY' | 'SCHEDULED';

export interface DeliveryChoice {
  /** CheckoutShipment.key */
  shipmentKey: string;
  type: DeliveryOptionType;
  /** Required for SCHEDULED: one of DeliveryOptionView.slots (YYYY-MM-DD, IST). */
  slotDate?: string;
}

/** Gateways behind the payment module. `bank` = the simulated ShopSphere Bank. */
export type PaymentProviderName = 'razorpay' | 'bank';

export type PaymentMethodChoice =
  | { type: 'ONLINE'; provider: PaymentProviderName }
  | { type: 'COD' };

/** Every field optional; `null` clears. Fields not sent are left unchanged. */
export interface UpdateCheckoutRequest {
  addressId?: string;
  deliveryOptions?: DeliveryChoice[];
  paymentMethod?: PaymentMethodChoice | null;
  couponCode?: string | null;
  /** Apply ShopSphere Pay / gift card balance (closed-loop). */
  useStoreBalance?: boolean;
}

export interface CheckoutAddress {
  id: string;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
}

/** GST included in a line (PRD: CGST+SGST intra-state, IGST inter-state). */
export interface LineTax {
  /** Basis points, 1800 = 18%. */
  rateBp: number;
  /** Value excluding GST, after coupon discount. */
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export type CheckoutLineIssue =
  | 'OUT_OF_STOCK'
  | 'LIMITED'
  | 'UNAVAILABLE'
  | 'UNSERVICEABLE'
  | 'PRICE_CHANGED';

export interface CheckoutLine {
  productId: string;
  skuId: string;
  offerId: string;
  sellerId: string;
  slug: string;
  title: string;
  /** Variant label, e.g. "Black, 128 GB". */
  variant: string | null;
  imageUrl: string | null;
  qty: number;
  unitPricePaise: Paise;
  mrpPaise: Paise;
  lineTotalPaise: Paise;
  /** Coupon discount allocated to this line. */
  discountPaise: Paise;
  tax: LineTax;
  /** Units still available to buy (stock − reserved). */
  available: number;
  issue: CheckoutLineIssue | null;
  /** Set when issue = PRICE_CHANGED: price when the line entered checkout. */
  previousUnitPricePaise: Paise | null;
}

export interface DeliveryOptionView {
  type: DeliveryOptionType;
  label: string;
  feePaise: Paise;
  /** YYYY-MM-DD (IST). For SCHEDULED: earliest slot. */
  deliveryDate: string;
  /** SCHEDULED only: selectable dates. */
  slots?: string[];
}

/** One seller/warehouse package (M4.5): one order, many shipments. */
export interface CheckoutShipment {
  key: string;
  sellerId: string;
  sellerName: string;
  fulfilledByShopSphere: boolean;
  lines: CheckoutLine[];
  options: DeliveryOptionView[];
  selected: DeliveryChoice;
  deliveryDate: string;
  deliveryFeePaise: Paise;
  itemsPaise: Paise;
}

export type CouponErrorCode =
  | 'COUPON_NOT_FOUND'
  | 'COUPON_NOT_STARTED'
  | 'COUPON_EXPIRED'
  | 'COUPON_MIN_ORDER'
  | 'COUPON_USAGE_LIMIT'
  | 'COUPON_NOT_APPLICABLE';

export interface AppliedCoupon {
  code: string;
  description: string;
  discountPaise: Paise;
}

export interface CheckoutTotals {
  /** Σ line totals (GST-inclusive selling price). */
  itemsPaise: Paise;
  mrpPaise: Paise;
  deliveryPaise: Paise;
  couponDiscountPaise: Paise;
  /** M6.6 bank offer (ShopSphere Bank payments only); already deducted from totalPaise. */
  bankOfferDiscountPaise?: Paise;
  codFeePaise: Paise;
  /** Order total incl. GST = items + delivery − coupon + COD fee. */
  totalPaise: Paise;
  /** Gift card / ShopSphere Pay balance applied. */
  storeBalancePaise: Paise;
  /** What the gateway (or courier, for COD) collects: total − store balance. */
  payablePaise: Paise;
  /** GST contained in the item lines (delivery and COD fees are shown without split). */
  tax: { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; totalPaise: Paise };
  savingsPaise: Paise;
}

export interface PaymentOption {
  method: PaymentMethodChoice;
  label: string;
  available: boolean;
  /** Why unavailable, e.g. COD_LIMIT, COD_PINCODE, COD_RISK, PROVIDER_DISABLED. */
  reason: string | null;
}

/** M4.20 stub: tokenised cards / UPI ids. Always empty until a gateway supports tokenisation. */
export interface SavedPaymentMethod {
  id: string;
  type: 'CARD' | 'UPI';
  label: string;
  provider: PaymentProviderName;
}

export interface CheckoutSession {
  id: string;
  status: CheckoutStatus;
  source: CheckoutSource;
  /** ISO 8601 UTC. */
  expiresAt: string;
  address: CheckoutAddress | null;
  /** True when every line can ship to the address. */
  serviceable: boolean;
  shipments: CheckoutShipment[];
  coupon: AppliedCoupon | null;
  /** Set when the requested coupon could not be applied (it is then dropped). */
  couponError: { code: CouponErrorCode; message: string } | null;
  /** M6.6: bank offer applied for the selected provider, if any. */
  bankOffer?: AppliedBankOffer | null;
  storeBalance: { availablePaise: Paise; applied: boolean };
  paymentMethod: PaymentMethodChoice | null;
  paymentOptions: PaymentOption[];
  savedMethods: SavedPaymentMethod[];
  totals: CheckoutTotals;
  /** Blocking problems; place-order is refused while non-empty. */
  issues: CheckoutIssue[];
  /** Set once placed. */
  orderId: string | null;
}

export type CheckoutIssueCode =
  | 'ADDRESS_REQUIRED'
  | 'PAYMENT_METHOD_REQUIRED'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'LINE_ISSUE'
  | 'EMPTY';

export interface CheckoutIssue {
  code: CheckoutIssueCode;
  message: string;
  skuId?: string;
}

// ───────── Place order ─────────

export interface PlaceOrderRequest {
  /**
   * The total the shopper saw. If the server total differs, place-order answers
   * 409 PRICE_CHANGED with details {previousTotalPaise, totalPaise, session} and creates nothing;
   * the client shows the diff and calls again with the new total.
   */
  expectedTotalPaise: Paise;
}

export type PlaceOrderNext =
  /** Pay `amountPaise` online before `payBy`; call POST /payments/:orderId/initiate. */
  | {
      type: 'PAY';
      amountPaise: Paise;
      providers: PaymentProviderName[];
      preferredProvider: PaymentProviderName;
      payBy: string;
    }
  /** COD, or fully covered by store balance: already CONFIRMED. */
  | { type: 'CONFIRMED' };

export interface PlaceOrderResponse {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  totalPaise: Paise;
  payablePaise: Paise;
  next: PlaceOrderNext;
}

/**
 * Error codes for checkout routes, rendered as ApiError {code, message, details}:
 * CHECKOUT_NOT_FOUND 404, CHECKOUT_EXPIRED 410, CHECKOUT_INVALID 422 (details: issues),
 * PRICE_CHANGED 409, OUT_OF_STOCK 409 (details: {skuId}), COUPON_* 422,
 * STORE_BALANCE_CHANGED 409, IDEMPOTENCY_KEY_REQUIRED 400.
 */
export type CheckoutErrorCode =
  | 'CHECKOUT_NOT_FOUND'
  | 'CHECKOUT_EXPIRED'
  | 'CHECKOUT_INVALID'
  | 'PRICE_CHANGED'
  | 'OUT_OF_STOCK'
  | 'STORE_BALANCE_CHANGED'
  | CouponErrorCode;

// ───────── Payment initiation ─────────

export interface InitiatePaymentRequest {
  provider: PaymentProviderName;
  /** Where the gateway sends the shopper back (`/checkout/result`); origin must be allowed. */
  returnUrl: string;
}

/** What the browser needs to open the gateway's hosted checkout. */
export type CheckoutDescriptor =
  | {
      kind: 'razorpay';
      keyId: string;
      providerOrderId: string;
      amountPaise: Paise;
      currency: string;
    }
  | { kind: 'redirect'; url: string };

export interface InitiatePaymentResponse {
  paymentId: string;
  orderId: string;
  provider: PaymentProviderName;
  providerOrderId: string;
  amountPaise: Paise;
  currency: string;
  checkout: CheckoutDescriptor;
}

/** Body of POST /payments/:orderId/verify (browser return; never marks the order paid). */
export interface VerifyPaymentRequest {
  provider: PaymentProviderName;
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

// ───────── Store balance (M4.7) ─────────

/**
 *   GET  /store-balance                      -> StoreBalanceResponse
 *   POST /store-balance/gift-cards/redeem    RedeemGiftCardRequest -> StoreBalanceResponse
 * Closed-loop only: usable on ShopSphere, no cash-out or transfer.
 */
export interface StoreBalanceResponse {
  balancePaise: Paise;
  entries: {
    id: string;
    amountPaise: Paise;
    /** GIFT_CARD_REDEEMED | ORDER_PAYMENT | ORDER_REFUND | ... */
    kind: string;
    reference: string | null;
    createdAt: string;
  }[];
}

export interface RedeemGiftCardRequest {
  code: string;
}
