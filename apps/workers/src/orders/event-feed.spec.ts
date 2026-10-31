import { runFeedOnce } from './event-feed';
import type { OrderEventEnvelope } from './order-events';

const ev = (id: string) =>
  ({
    id,
    type: 'order.status_changed',
    occurredAt: '',
    payload: {},
  }) as unknown as OrderEventEnvelope;

describe('order event feed', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const opts = { apiUrl: 'http://api', internalToken: 'x', intervalMs: 1000 };
  const feed = (events: OrderEventEnvelope[]) =>
    (global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ events, cursor: 'c0' }), { status: 200 }),
    ) as unknown as typeof fetch);

  it('runs every consumer per event and advances the cursor', async () => {
    feed([ev('e1'), ev('e2')]);
    const seen: string[] = [];
    const cursor = await runFeedOnce(opts, 'e0', {
      a: async (e) => seen.push(`a:${e.id}`),
      b: async (e) => seen.push(`b:${e.id}`),
    });
    expect(seen).toEqual(['a:e1', 'b:e1', 'a:e2', 'b:e2']);
    expect(cursor).toBe('e2');
  });

  it('stops before a failing event so it is retried next tick', async () => {
    feed([ev('e1'), ev('e2')]);
    const cursor = await runFeedOnce(opts, 'e0', {
      a: async (e) => {
        if (e.id === 'e2') throw new Error('boom');
      },
    });
    expect(cursor).toBe('e1');
  });
});
