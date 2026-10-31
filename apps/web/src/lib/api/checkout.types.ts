/**
 * Web view types for checkout (M4.21–M4.26). Modelled on the checkout/payment endpoints; the
 * backend publishes its DTOs in packages/types/src/checkout.ts and checkout.ts maps them here
 * at merge time. All money is integer paise and every total is computed by the server.
 */

export type DeliverySpeed = 'STANDARD' | 'ONE_DAY' | 'SCHEDULED';

/** BANK = ShopSphere Bank hosted checkout, RAZORPAY = Razorpay test mode, GIFT_CARD = balance only. */
export type PaymentMethod = 'BANK' | 'RAZORPAY' | 'COD' | 'GIFT_CARD';

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
  type: 'HOME' | 'WORK';
  isDefault: boolean;
}

export type NewAddress = Omit<CheckoutAddress, 'id' | 'isDefault'>;

export interface DeliveryOption {
  speed: DeliverySpeed;
  label: string;
  fee: number;
  /** YYYY-MM-DD (IST). */
  deliveryDate: string;
  /** Only for SCHEDULED, e.g. "08:00–12:00". */
  slots: string[];
}

export interface CheckoutItem {
  lineId: string;
  skuId: string;
  slug: string;
  title: string;
  variant: Record<string, string>;
  image: string | null;
  qty: number;
  unitPrice: number;
  mrp: number;
  lineTotal: number;
  /** False when the selected address pincode cannot receive this item. */
  serviceable: boolean;
}

/** One shipment per seller (+ fulfilment); one order may have many. */
export interface CheckoutShipment {
  id: string;
  sellerId: string;
  sellerName: string;
  fulfilment: 'SHOPSPHERE' | 'SELLER';
  items: CheckoutItem[];
  options: DeliveryOption[];
  selected: DeliverySpeed;
  slot: string | null;
}

export interface PaymentMethodOption {
  method: PaymentMethod;
  label: string;
  enabled: boolean;
  /** Why it is disabled, e.g. "COD not available above ₹50,000". */
  reason: string | null;
}

/** PRD §8 price breakdown, server-computed. */
export interface PriceBreakdown {
  items: number;
  mrp: number;
  delivery: number;
  /** Coupon / bank offer, positive number shown as a deduction. */
  discount: number;
  /** Gift card / ShopSphere Pay balance applied, positive number shown as a deduction. */
  giftCard: number;
  codFee: number;
  /** Amount still to pay (incl. GST). */
  total: number;
  savings: number;
}

export interface CheckoutIssue {
  code: 'NOT_SERVICEABLE' | 'OUT_OF_STOCK' | 'PRICE_CHANGED' | 'COUPON_INVALID';
  message: string;
  lineIds: string[];
}

export interface CheckoutSession {
  id: string;
  source: 'CART' | 'BUY_NOW';
  /** ISO 8601 UTC; sessions time out after 30 minutes. */
  expiresAt: string;
  addresses: CheckoutAddress[];
  addressId: string | null;
  shipments: CheckoutShipment[];
  methods: PaymentMethodOption[];
  paymentMethod: PaymentMethod | null;
  coupon: { code: string; discount: number } | null;
  giftCard: { balance: number; applied: number } | null;
  price: PriceBreakdown;
  issues: CheckoutIssue[];
}

export type CheckoutSource =
  | { type: 'CART' }
  | {
      type: 'BUY_NOW';
      sku: string;
      sellerId?: string;
      qty: number;
      /** Display hint for the mock only; never sent to the server (it prices the SKU itself). */
      preview?: { title: string; slug: string; price: number; mrp?: number };
    };

/** PATCH /checkout/:id. Fields left out are unchanged; null clears. */
export interface CheckoutPatch {
  addressId?: string;
  newAddress?: NewAddress;
  delivery?: { shipmentId: string; speed: DeliverySpeed; slot?: string | null };
  paymentMethod?: PaymentMethod;
  couponCode?: string | null;
  giftCardCode?: string;
  useGiftCardBalance?: boolean;
  removeLineIds?: string[];
}

export interface PriceChange {
  lineId: string;
  title: string;
  from: number;
  to: number;
}

export type PlaceOrderResponse =
  | {
      status: 'PRICE_CHANGED';
      changes: PriceChange[];
      previousTotal: number;
      checkout: CheckoutSession;
    }
  | {
      status: 'PLACED';
      orderId: string;
      orderNumber: string;
      /** True when the order needs an online payment (BANK / RAZORPAY). */
      paymentRequired: boolean;
      amount: number;
    };

export type GatewayCheckout =
  | {
      kind: 'razorpay';
      keyId: string;
      providerOrderId: string;
      amountPaise: number;
      currency: string;
    }
  | { kind: 'redirect'; url: string };

export interface InitiatePaymentResponse {
  paymentId: string;
  orderId: string;
  checkout: GatewayCheckout;
}

/** GET /orders/:id/status, polled from /checkout/result. */
export interface OrderPaymentStatus {
  orderId: string;
  orderNumber: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'PAYMENT_FAILED' | 'CANCELLED';
  paymentState: 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED' | 'NOT_REQUIRED';
  amount: number;
  failureReason: string | null;
  /** Retry allowed until this time (15-minute window), ISO 8601 UTC. */
  retryUntil: string | null;
}
