/**
 * Payment reconciliation (M4.17). Every 5 minutes asks the API to poll the gateways for
 * payments still open in the last 24 h, apply missed captures/failures, capture authorized
 * payments and retry refunds. The API does the work inside the payment module so state
 * changes stay behind its service boundary; this job is only the scheduler.
 *
 * Stub: a plain interval. Moves to a BullMQ repeatable job once the queue infra lands.
 */
export interface ReconcileJobOptions {
  apiUrl: string;
  internalToken: string;
  intervalMs: number;
}

export function reconcileOptionsFromEnv(env: NodeJS.ProcessEnv): ReconcileJobOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.PAYMENT_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
    intervalMs: Number(env.PAYMENT_RECONCILE_INTERVAL_MS ?? 5 * 60 * 1000),
  };
}

export async function runReconcileOnce(opts: ReconcileJobOptions): Promise<unknown> {
  const res = await fetch(`${opts.apiUrl}/payments/internal/reconcile`, {
    method: 'POST',
    headers: { 'x-internal-token': opts.internalToken },
    signal: AbortSignal.timeout(60_000),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`reconcile failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

const log = (level: 'info' | 'warn', msg: string, extra: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({
      level,
      msg,
      job: 'payments.reconcile',
      time: new Date().toISOString(),
      ...extra,
    }),
  );

/** Starts the schedule; overlapping runs are skipped. Returns a stop function. */
export function startReconcileJob(opts: ReconcileJobOptions): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      log('info', 'reconcile run', { summary: await runReconcileOnce(opts) });
    } catch (err) {
      log('warn', 'reconcile run failed', { error: (err as Error).message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs);
  void tick();
  return () => clearInterval(timer);
}
