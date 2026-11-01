import { analyticsAllowed } from './consent';

/**
 * Analytics events (M3.10). No vendor is wired yet: events go to `window.dataLayer` when a tag
 * manager provides one and are also dispatched as a `ss:analytics` DOM event (handy in tests).
 * Nothing is sent unless the shopper opted in to analytics cookies (M7.3, `lib/consent.ts`).
 */
export type AnalyticsEvent = 'add_to_cart' | 'remove_from_cart' | 'view_cart';

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined' || !analyticsAllowed()) return;
  window.dataLayer?.push({ event, ...props });
  window.dispatchEvent(new CustomEvent('ss:analytics', { detail: { event, ...props } }));
}
