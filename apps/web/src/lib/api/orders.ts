import { CHECKOUT_MOCK, type Requester } from './checkout';
import type { OrderDetail, OrdersPage, OrdersQuery } from './orders.types';
import { ApiRequestError } from '../api';

/**
 * "Your Orders" data (M4.28). Same mock switch as checkout (NEXT_PUBLIC_CHECKOUT_MOCK=1).
 *   GET  /orders?year=&status=&page=   -> OrdersPage
 *   GET  /orders/:id                   -> OrderDetail
 *   POST /orders/:id/cancel  {reason}  -> OrderDetail
 */

const mock = () => import('./orders.mock');
const enc = encodeURIComponent;

export function ordersApi(request: Requester) {
  return {
    async list(q: OrdersQuery = {}) {
      if (CHECKOUT_MOCK) return (await mock()).listOrders(q);
      const params = new URLSearchParams();
      if (q.year) params.set('year', String(q.year));
      if (q.status && q.status !== 'ALL') params.set('status', q.status);
      if (q.page) params.set('page', String(q.page));
      const qs = params.toString();
      return request<OrdersPage>(`/orders${qs ? `?${qs}` : ''}`);
    },

    async get(id: string): Promise<OrderDetail | null> {
      if (CHECKOUT_MOCK) return (await mock()).getOrder(id);
      try {
        return await request<OrderDetail>(`/orders/${enc(id)}`);
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) return null;
        throw e;
      }
    },

    async cancel(id: string, reason: string) {
      if (CHECKOUT_MOCK) return (await mock()).cancelOrder(id, reason);
      return request<OrderDetail>(`/orders/${enc(id)}/cancel`, {
        method: 'POST',
        body: { reason },
      });
    },
  };
}
