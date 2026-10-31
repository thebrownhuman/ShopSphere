import type { OrderEventEnvelope } from '../orders/order-events';

/**
 * Notification consumer (M4.31): forwards order events to the API notification module, which
 * renders templates, checks the shopper's preferences and sends email + SMS. The API dedupes on
 * the event id (ProcessedEventsService), so redelivery never double-sends.
 */
export interface NotifyJobOptions {
  apiUrl: string;
  internalToken: string;
}

export function notifyOptionsFromEnv(env: NodeJS.ProcessEnv): NotifyJobOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.NOTIFICATION_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
  };
}

export async function handleNotifyEvent(
  opts: NotifyJobOptions,
  event: OrderEventEnvelope,
): Promise<{ sent: string[] }> {
  const res = await fetch(`${opts.apiUrl}/notifications/internal/dispatch`, {
    method: 'POST',
    headers: { 'x-internal-token': opts.internalToken, 'content-type': 'application/json' },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(30_000),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`notify failed (${res.status}): ${JSON.stringify(body)}`);
  return body as { sent: string[] };
}
