import { ORDER_EVENT_TYPES, type OrderEventEnvelope } from './order-events';

/**
 * Order event feed: polls the API for outbox events after a cursor and hands each to every
 * consumer in order. The cursor only moves past an event once all consumers succeeded, so a
 * failure is retried on the next tick (consumers must be idempotent).
 *
 * Stub transport, like the other jobs: becomes a BullMQ consumer once the outbox publisher pushes
 * to queues (OutboxPublisher TODO). Endpoint: GET /notifications/internal/events?after=&types=.
 */
export type OrderEventConsumer = (event: OrderEventEnvelope) => Promise<unknown>;

export interface EventFeedOptions {
  apiUrl: string;
  internalToken: string;
  intervalMs: number;
  /** Start after this event id; empty = only events from now on (the API resolves "latest"). */
  after?: string;
}

export function eventFeedOptionsFromEnv(env: NodeJS.ProcessEnv): EventFeedOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.NOTIFICATION_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
    intervalMs: Number(env.ORDER_EVENTS_INTERVAL_MS ?? 5_000),
    after: env.ORDER_EVENTS_AFTER,
  };
}

const log = (level: 'info' | 'warn', msg: string, extra: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ level, msg, job: 'orders.events', time: new Date().toISOString(), ...extra }),
  );

export async function fetchEvents(
  opts: EventFeedOptions,
  after: string | undefined,
): Promise<{ events: OrderEventEnvelope[]; cursor: string | null }> {
  const q = new URLSearchParams({ types: ORDER_EVENT_TYPES.join(',') });
  if (after) q.set('after', after);
  const res = await fetch(`${opts.apiUrl}/notifications/internal/events?${q}`, {
    headers: { 'x-internal-token': opts.internalToken },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`event feed failed (${res.status})`);
  return (await res.json()) as { events: OrderEventEnvelope[]; cursor: string | null };
}

/** Processes one batch; returns the new cursor. */
export async function runFeedOnce(
  opts: EventFeedOptions,
  after: string | undefined,
  consumers: Record<string, OrderEventConsumer>,
): Promise<string | undefined> {
  const { events, cursor } = await fetchEvents(opts, after);
  let last = after ?? cursor ?? undefined;
  for (const event of events) {
    for (const [name, consume] of Object.entries(consumers)) {
      try {
        await consume(event);
      } catch (err) {
        log('warn', 'consumer failed', {
          consumer: name,
          event: event.id,
          error: (err as Error).message,
        });
        return last;
      }
    }
    last = event.id;
  }
  return last;
}

export function startEventFeed(
  opts: EventFeedOptions,
  consumers: Record<string, OrderEventConsumer>,
): () => void {
  let cursor = opts.after;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      cursor = await runFeedOnce(opts, cursor, consumers);
    } catch (err) {
      log('warn', 'feed run failed', { error: (err as Error).message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs);
  void tick();
  return () => clearInterval(timer);
}
