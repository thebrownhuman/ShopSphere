import type {
  Address,
  CartResponse,
  CheckoutSession as ApiSession,
  CreateCheckoutRequest,
  InitiatePaymentResponse as ApiInitiate,
  OrderDetail as ApiOrderDetail,
  OrderStatusResponse,
  PlaceOrderResponse as ApiPlaced,
  UpdateCheckoutRequest,
} from '@shopsphere/types';
import { ApiRequestError, type RequestOptions } from '../api';
import { choiceFromMethod, providerOf, toPaymentStatus, toSession } from './checkout.adapters';
import type {
  CheckoutPatch,
  CheckoutSession,
  CheckoutSource,
  InitiatePaymentResponse,
  OrderPaymentStatus,
  PlaceOrderResponse,
  PriceChange,
} from './checkout.types';

/**
 * Single entry point for checkout + payment data (M4.21–M4.26). Pages never call fetch directly,
 * so the mock (NEXT_PUBLIC_CHECKOUT_MOCK=1) and the real API are interchangeable. Backend
 * contract: packages/types/src/checkout.ts + order.ts; DTO mapping in checkout.adapters.ts.
 */

export const CHECKOUT_MOCK = process.env.NEXT_PUBLIC_CHECKOUT_MOCK === '1';

/** Bearer request from useAuth(); carries cookies, CSRF and one silent refresh. */
export type Requester = <T>(path: string, opts?: Omit<RequestOptions, 'accessToken'>) => Promise<T>;

/** sessionStorage key the PDP Buy Now button uses for the mock's display hint. */
export const BUY_NOW_PREVIEW_KEY = 'ss_buy_now_preview';

export type GatewayProvider = 'bank' | 'razorpay';

const mock = () => import('./checkout.mock');
const enc = encodeURIComponent;

/** Last raw session per id: place-order must send the order total, the view shows payable. */
const raw = new Map<string, ApiSession>();

function realApi(request: Requester) {
  const addresses = () => request<Address[]>('/me/addresses').catch(() => [] as Address[]);
  const view = async (s: ApiSession) => {
    raw.set(s.id, s);
    return toSession(s, await addresses());
  };
  const patch = (id: string, body: UpdateCheckoutRequest) =>
    request<ApiSession>(`/checkout/${enc(id)}`, { method: 'PATCH', body });
  const create = (body: CreateCheckoutRequest) =>
    request<ApiSession>('/checkout', { method: 'POST', body });
  const orderNumbers = new Map<string, string>();

  return {
    async create(source: CheckoutSource) {
      return view(
        await create(
          source.type === 'BUY_NOW'
            ? { source: 'BUY_NOW', skuId: source.sku, sellerId: source.sellerId, qty: source.qty }
            : { source: 'CART' },
        ),
      );
    },

    async update(id: string, p: CheckoutPatch): Promise<CheckoutSession> {
      const current = raw.get(id);
      if (p.removeLineIds?.length) {
        // Checkout has no line removal: drop the lines from the cart and start a fresh session.
        if (current?.source !== 'CART')
          throw new ApiRequestError(422, {
            code: 'CHECKOUT_INVALID',
            message: 'This item cannot be delivered to the selected address',
          });
        const cart = await request<CartResponse>('/cart');
        const lines = cart.groups.flatMap((g) => g.lines);
        for (const skuId of p.removeLineIds) {
          const line = lines.find((l) => l.skuId === skuId);
          if (line) await request(`/cart/items/${enc(line.id)}`, { method: 'DELETE' });
        }
        return view(await create({ source: 'CART', addressId: current.address?.id }));
      }
      if (p.newAddress) {
        const a = await request<Address>('/me/addresses', {
          method: 'POST',
          body: { ...p.newAddress, type: p.newAddress.type === 'WORK' ? 'work' : 'home' },
        });
        return view(await patch(id, { addressId: a.id }));
      }
      if (p.giftCardCode !== undefined) {
        await request('/store-balance/gift-cards/redeem', {
          method: 'POST',
          body: { code: p.giftCardCode.trim() },
        });
        return view(await patch(id, { useStoreBalance: true }));
      }
      const body: UpdateCheckoutRequest = {};
      if (p.addressId) body.addressId = p.addressId;
      if (p.couponCode !== undefined) body.couponCode = p.couponCode;
      if (p.useGiftCardBalance !== undefined) body.useStoreBalance = p.useGiftCardBalance;
      if (p.paymentMethod === 'GIFT_CARD') body.useStoreBalance = true;
      else if (p.paymentMethod) body.paymentMethod = choiceFromMethod(p.paymentMethod);
      if (p.delivery && current) {
        body.deliveryOptions = current.shipments.map((sh) =>
          sh.key === p.delivery!.shipmentId
            ? {
                shipmentKey: sh.key,
                type: p.delivery!.speed,
                ...(p.delivery!.speed === 'SCHEDULED'
                  ? {
                      slotDate:
                        p.delivery!.slot ??
                        sh.options.find((o) => o.type === 'SCHEDULED')?.slots?.[0],
                    }
                  : {}),
              }
            : sh.selected,
        );
      }
      const next = await patch(id, body);
      // The server drops a coupon it cannot apply and says why; surface that as an error.
      if (p.couponCode && next.couponError) {
        raw.set(next.id, next);
        throw new ApiRequestError(422, {
          code: next.couponError.code,
          message: next.couponError.message,
        });
      }
      return view(next);
    },

    async placeOrder(id: string, _payable: number, idempotencyKey: string) {
      const current = raw.get(id);
      if (!current)
        throw new ApiRequestError(404, { code: 'CHECKOUT_NOT_FOUND', message: 'Checkout expired' });
      try {
        const res = await request<ApiPlaced>(`/checkout/${enc(id)}/place-order`, {
          method: 'POST',
          body: { expectedTotalPaise: current.totals.totalPaise },
          headers: { 'idempotency-key': idempotencyKey },
        });
        orderNumbers.set(res.orderId, res.orderNumber);
        return {
          status: 'PLACED',
          orderId: res.orderId,
          orderNumber: res.orderNumber,
          paymentRequired: res.next.type === 'PAY',
          amount: res.payablePaise,
        } satisfies PlaceOrderResponse;
      } catch (e) {
        const details = (
          e instanceof ApiRequestError && e.code === 'PRICE_CHANGED' ? e.body?.details : null
        ) as { previousTotalPaise: number; session: ApiSession } | null;
        if (!details) throw e;
        const before = new Map(
          current.shipments.flatMap((s) => s.lines).map((l) => [l.skuId, l.unitPricePaise]),
        );
        const changes: PriceChange[] = details.session.shipments
          .flatMap((s) => s.lines)
          .filter((l) => before.has(l.skuId) && before.get(l.skuId) !== l.unitPricePaise)
          .map((l) => ({
            lineId: l.skuId,
            title: l.title,
            from: before.get(l.skuId)!,
            to: l.unitPricePaise,
          }));
        return {
          status: 'PRICE_CHANGED',
          changes,
          previousTotal: details.previousTotalPaise,
          checkout: await view(details.session),
        } satisfies PlaceOrderResponse;
      }
    },

    async initiatePayment(orderId: string, provider: GatewayProvider, returnUrl: string) {
      const r = await request<ApiInitiate>(`/payments/${enc(orderId)}/initiate`, {
        method: 'POST',
        body: { provider, returnUrl },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      return {
        paymentId: r.paymentId,
        orderId: r.orderId,
        checkout: r.checkout,
      } satisfies InitiatePaymentResponse;
    },

    async verifyRedirect(
      orderId: string,
      body: {
        provider: GatewayProvider;
        providerOrderId: string;
        providerPaymentId: string;
        signature: string;
      },
    ) {
      await request<unknown>(`/payments/${enc(orderId)}/verify`, { method: 'POST', body });
    },

    async status(orderId: string): Promise<OrderPaymentStatus> {
      const s = await request<OrderStatusResponse>(`/orders/${enc(orderId)}/status`);
      let number = orderNumbers.get(orderId);
      let reason: string | null = null;
      if (!number || s.paymentState === 'FAILED') {
        const d = await request<ApiOrderDetail>(`/orders/${enc(orderId)}`);
        number = d.number;
        orderNumbers.set(orderId, number);
        reason =
          [...d.events].reverse().find((e) => e.type === 'PAYMENT_ATTEMPT_FAILED')?.note ?? null;
      }
      return toPaymentStatus(s, number, reason);
    },
  };
}

export function checkoutApi(request: Requester) {
  const real = realApi(request);
  return {
    async create(source: CheckoutSource, opts: { priceChangeOnce?: boolean } = {}) {
      if (CHECKOUT_MOCK) return (await mock()).createCheckout(source, opts);
      return real.create(source);
    },
    async update(id: string, patch: CheckoutPatch) {
      if (CHECKOUT_MOCK) return (await mock()).updateCheckout(id, patch);
      return real.update(id, patch);
    },
    /** `idempotencyKey` is minted once per checkout total so double clicks and two tabs place one order. */
    async placeOrder(id: string, expectedTotal: number, idempotencyKey: string) {
      if (CHECKOUT_MOCK) return (await mock()).placeOrder(id, expectedTotal);
      return real.placeOrder(id, expectedTotal, idempotencyKey);
    },
    async initiatePayment(orderId: string, provider: GatewayProvider, returnUrl: string) {
      if (CHECKOUT_MOCK) return (await mock()).initiatePayment(orderId, provider, returnUrl);
      return real.initiatePayment(orderId, provider, returnUrl);
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
      return real.verifyRedirect(orderId, body);
    },
    async status(orderId: string) {
      if (CHECKOUT_MOCK) return (await mock()).getOrderStatus(orderId);
      return real.status(orderId);
    },
  };
}

export { providerOf };
export type CheckoutApi = ReturnType<typeof checkoutApi>;
