import type { RequestOptions } from '../api';
import type {
  CheckoutPatch,
  CheckoutSession,
  CheckoutSource,
  InitiatePaymentResponse,
  OrderPaymentStatus,
  PlaceOrderResponse,
} from './checkout.types';

/**
 * Single entry point for checkout + payment data (M4.21–M4.26). Pages never call fetch directly,
 * so the mock (NEXT_PUBLIC_CHECKOUT_MOCK=1) and the real API are interchangeable.
 *
 * Endpoints (backend contract in packages/types/src/checkout.ts, reconciled at merge):
 *   POST  /checkout                      { source }            -> CheckoutSession
 *   PATCH /checkout/:id                  CheckoutPatch         -> CheckoutSession
 *   POST  /checkout/:id/place-order      { expectedTotal }     -> PlaceOrderResponse  (Idempotency-Key)
 *   POST  /payments/:orderId/initiate    { provider, returnUrl } -> InitiatePaymentResponse (Idempotency-Key)
 *   POST  /payments/:orderId/verify      redirect signature    -> (ignored; webhook is authoritative)
 *   GET   /orders/:id/status                                   -> OrderPaymentStatus
 */

export const CHECKOUT_MOCK = process.env.NEXT_PUBLIC_CHECKOUT_MOCK === '1';

/** Bearer request from useAuth(); carries cookies, CSRF and one silent refresh. */
export type Requester = <T>(path: string, opts?: Omit<RequestOptions, 'accessToken'>) => Promise<T>;

/** sessionStorage key the PDP Buy Now button uses for the mock's display hint. */
export const BUY_NOW_PREVIEW_KEY = 'ss_buy_now_preview';

export type GatewayProvider = 'bank' | 'razorpay';

const mock = () => import('./checkout.mock');
const enc = encodeURIComponent;

export function checkoutApi(request: Requester) {
  return {
    async create(source: CheckoutSource, opts: { priceChangeOnce?: boolean } = {}) {
      if (CHECKOUT_MOCK) return (await mock()).createCheckout(source, opts);
      const body =
        source.type === 'BUY_NOW'
          ? { type: source.type, sku: source.sku, sellerId: source.sellerId, qty: source.qty }
          : source;
      return request<CheckoutSession>('/checkout', { method: 'POST', body: { source: body } });
    },

    async update(id: string, patch: CheckoutPatch) {
      if (CHECKOUT_MOCK) return (await mock()).updateCheckout(id, patch);
      return request<CheckoutSession>(`/checkout/${enc(id)}`, { method: 'PATCH', body: patch });
    },

    /** `idempotencyKey` is minted once per checkout session so double clicks and two tabs place one order. */
    async placeOrder(id: string, expectedTotal: number, idempotencyKey: string) {
      if (CHECKOUT_MOCK) return (await mock()).placeOrder(id, expectedTotal);
      return request<PlaceOrderResponse>(`/checkout/${enc(id)}/place-order`, {
        method: 'POST',
        body: { expectedTotal },
        headers: { 'idempotency-key': idempotencyKey },
      });
    },

    async initiatePayment(orderId: string, provider: GatewayProvider, returnUrl: string) {
      if (CHECKOUT_MOCK) return (await mock()).initiatePayment(orderId, provider, returnUrl);
      return request<InitiatePaymentResponse>(`/payments/${enc(orderId)}/initiate`, {
        method: 'POST',
        body: { provider, returnUrl },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
    },

    /** Lets the server check the redirect signature early; the webhook still decides. */
    async verifyRedirect(
      orderId: string,
      body: {
        provider: GatewayProvider;
        providerOrderId: string;
        providerPaymentId: string;
        signature: string;
      },
    ) {
      if (CHECKOUT_MOCK) return;
      await request<unknown>(`/payments/${enc(orderId)}/verify`, { method: 'POST', body });
    },

    async status(orderId: string) {
      if (CHECKOUT_MOCK) return (await mock()).getOrderStatus(orderId);
      return request<OrderPaymentStatus>(`/orders/${enc(orderId)}/status`);
    },
  };
}

export type CheckoutApi = ReturnType<typeof checkoutApi>;
