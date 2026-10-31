/**
 * Search indexer (M2.9). Every few seconds asks the API to consume pending `product.changed`
 * / `offer.changed` outbox events and partially reindex the affected products. Document
 * building lives in the API's search module so the index stays behind its service boundary;
 * stock-only changes are debounced there (max one reindex per product per 60 s).
 *
 * Stub scheduler: a plain interval, moving to a BullMQ repeatable job with the queue infra.
 */
export interface IndexJobOptions {
  apiUrl: string;
  internalToken: string;
  intervalMs: number;
}

export function indexOptionsFromEnv(env: NodeJS.ProcessEnv): IndexJobOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.CATALOG_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
    intervalMs: Number(env.SEARCH_INDEX_INTERVAL_MS ?? 2000),
  };
}

export interface IndexRunSummary {
  events: number;
  indexed: number;
  deferred: number;
}

export async function runIndexOnce(opts: IndexJobOptions): Promise<IndexRunSummary> {
  const res = await fetch(`${opts.apiUrl}/search/internal/index`, {
    method: 'POST',
    headers: { 'x-internal-token': opts.internalToken },
    signal: AbortSignal.timeout(60_000),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`index run failed (${res.status}): ${JSON.stringify(body)}`);
  return body as IndexRunSummary;
}

const log = (level: 'info' | 'warn', msg: string, extra: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ level, msg, job: 'search.index', time: new Date().toISOString(), ...extra }),
  );

/** Starts the schedule; overlapping runs are skipped. Returns a stop function. */
export function startIndexJob(opts: IndexJobOptions): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await runIndexOnce(opts);
      if (summary.events > 0 || summary.indexed > 0) log('info', 'index run', { summary });
    } catch (err) {
      log('warn', 'index run failed', { error: (err as Error).message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs);
  void tick();
  return () => clearInterval(timer);
}
