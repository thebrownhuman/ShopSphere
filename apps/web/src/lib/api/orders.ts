import type { OrderDetail as ApiOrderDetail, OrdersPage as ApiOrdersPage } from '@shopsphere/types';
import { ApiRequestError } from '../api';
import { toOrderDetail, toOrderSummary } from './checkout.adapters';
import { CHECKOUT_MOCK, type Requester } from './checkout';
import type { OrderDetail, OrdersPage, OrdersQuery } from './orders.types';

/**
 * "Your Orders" data (M4.28). Same mock switch as checkout (NEXT_PUBLIC_CHECKOUT_MOCK=1).
 *   GET  /orders?year=&status=a,b&cursor=&limit=  -> OrdersPage
 *   GET  /orders/:id                              -> OrderDetail
 *   POST /orders/:id/cancel  {reason}             -> OrderDetail
 */

const mock = () => import('./orders.mock');
const enc = encodeURIComponent;

const STATUS_FILTER: Record<NonNullable<OrdersQuery['status']>, string | null> = {
  ALL: null,
  ACTIVE: 'PENDING_PAYMENT,CONFIRMED,PACKED,SHIPPED,OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED,CANCELLED_NO_STOCK,PAYMENT_FAILED',
};

const PAGE_SIZE = 50;

/** The API does not list order years; offer this year and the two before. */
const recentYears = () => {
  const y = new Date().getUTCFullYear();
  return [y, y - 1, y - 2];
};

export function ordersApi(request: Requester) {
  return {
    async list(q: OrdersQuery = {}): Promise<OrdersPage> {
      if (CHECKOUT_MOCK) return (await mock()).listOrders(q);
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (q.year) params.set('year', String(q.year));
      const status = STATUS_FILTER[q.status ?? 'ALL'];
      if (status) params.set('status', status);
      const page = await request<ApiOrdersPage>(`/orders?${params}`);
      return {
        orders: page.items.map(toOrderSummary),
        years: recentYears(),
        total: page.items.length,
        page: 1,
        pageSize: PAGE_SIZE,
      };
    },

    async get(id: string): Promise<OrderDetail | null> {
      if (CHECKOUT_MOCK) return (await mock()).getOrder(id);
      try {
        return toOrderDetail(await request<ApiOrderDetail>(`/orders/${enc(id)}`));
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 404) return null;
        throw e;
      }
    },

    async cancel(id: string, reason: string): Promise<OrderDetail> {
      if (CHECKOUT_MOCK) return (await mock()).cancelOrder(id, reason);
      return toOrderDetail(
        await request<ApiOrderDetail>(`/orders/${enc(id)}/cancel`, {
          method: 'POST',
          body: { reason },
        }),
      );
    },
  };
}
