import type {
  CreateReturnRequest,
  CreateTicketRequest,
  HelpArticle,
  PushPublicKey,
  PushSubscriptionRequest,
  ReturnInfo,
  ReturnView,
  SupportTicket,
} from '@shopsphere/types';
import { apiGet } from '../api';
import type { Requester } from './checkout';

/**
 * Returns (M6.1), support tickets (M6.8) and web push subscriptions (M6.9).
 *   GET  /orders/:id/return  -> ReturnInfo      POST /orders/:id/return -> ReturnView
 *   GET  /help/articles?q=   -> { items }       GET  /help/articles/:slug
 *   GET/POST /support/tickets
 *   GET  /notifications/push/key, POST/DELETE /notifications/push/subscriptions
 */
const enc = encodeURIComponent;

export function returnsApi(request: Requester) {
  return {
    info: (orderId: string) => request<ReturnInfo>(`/orders/${enc(orderId)}/return`),
    create: (orderId: string, body: CreateReturnRequest) =>
      request<ReturnView>(`/orders/${enc(orderId)}/return`, { method: 'POST', body }),
  };
}

export function supportApi(request: Requester) {
  return {
    tickets: () => request<{ items: SupportTicket[] }>('/support/tickets'),
    create: (body: CreateTicketRequest) =>
      request<SupportTicket>('/support/tickets', { method: 'POST', body }),
  };
}

export const helpArticles = (q?: string) =>
  apiGet<{ items: HelpArticle[] }>(`/help/articles${q ? `?q=${enc(q)}` : ''}`);
export const helpArticle = (slug: string) => apiGet<HelpArticle>(`/help/articles/${enc(slug)}`);

export function pushApi(request: Requester) {
  return {
    key: () => apiGet<PushPublicKey>('/notifications/push/key'),
    subscribe: (body: PushSubscriptionRequest) =>
      request<void>('/notifications/push/subscriptions', { method: 'POST', body }),
    unsubscribe: (endpoint: string) =>
      request<void>('/notifications/push/subscriptions', { method: 'DELETE', body: { endpoint } }),
    test: () => request<{ delivered: number }>('/notifications/push/test', { method: 'POST' }),
  };
}
