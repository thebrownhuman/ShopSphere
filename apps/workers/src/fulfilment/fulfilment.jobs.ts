/**
 * Fulfilment schedulers (M5.6, M5.6a, M5.7). Like payments/reconcile.job.ts these only call
 * internal API endpoints; the work happens behind the API's module boundaries.
 *
 *   shipping.sync-tracking           every TRACKING_SYNC_INTERVAL_MS (10 min): missed courier webhooks
 *   shipping.refresh-serviceability  daily at SERVICEABILITY_REFRESH_HOUR_IST (02:00 IST)
 *   settlement.run-payouts           daily at PAYOUT_RUN_HOUR_IST (06:00 IST): T+7 payout batch
 *
 * Stub: plain timers. Moves to BullMQ repeatable jobs once the queue infra lands.
 */
export interface FulfilmentJobOptions {
  apiUrl: string;
  internalToken: string;
  trackingIntervalMs: number;
  serviceabilityHourIst: number;
  payoutHourIst: number;
}

export function fulfilmentOptionsFromEnv(env: NodeJS.ProcessEnv): FulfilmentJobOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.PAYMENT_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
    trackingIntervalMs: Number(env.TRACKING_SYNC_INTERVAL_MS ?? 10 * 60 * 1000),
    serviceabilityHourIst: Number(env.SERVICEABILITY_REFRESH_HOUR_IST ?? 2),
    payoutHourIst: Number(env.PAYOUT_RUN_HOUR_IST ?? 6),
  };
}

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Next time the IST wall clock reads `hour`:00 strictly after `now`. */
export function nextDailyRun(now: Date, hourIst: number): Date {
  const istMidnight = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  let at = istMidnight + hourIst * 3_600_000;
  if (at <= now.getTime()) at += DAY_MS;
  return new Date(at);
}

async function callInternal(opts: FulfilmentJobOptions, path: string): Promise<unknown> {
  const res = await fetch(`${opts.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'x-internal-token': opts.internalToken },
    signal: AbortSignal.timeout(120_000),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${JSON.stringify(body)}`);
  return body;
}

const log = (
  level: 'info' | 'warn',
  job: string,
  msg: string,
  extra: Record<string, unknown> = {},
) => console.log(JSON.stringify({ level, msg, job, time: new Date().toISOString(), ...extra }));

/** Wraps a call so overlapping runs are skipped and failures are logged, never thrown. */
function runner(opts: FulfilmentJobOptions, job: string, path: string) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      log('info', job, 'run', { summary: await callInternal(opts, path) });
    } catch (err) {
      log('warn', job, 'run failed', { error: (err as Error).message });
    } finally {
      running = false;
    }
  };
}

function daily(run: () => Promise<void>, hourIst: number): () => void {
  let timer: NodeJS.Timeout;
  const schedule = () => {
    timer = setTimeout(
      () => {
        void run().finally(schedule);
      },
      nextDailyRun(new Date(), hourIst).getTime() - Date.now(),
    );
  };
  schedule();
  return () => clearTimeout(timer);
}

/** Starts all fulfilment schedules. Returns a stop function. */
export function startFulfilmentJobs(opts: FulfilmentJobOptions): () => void {
  const tracking = runner(opts, 'shipping.sync-tracking', '/shipping/internal/sync-tracking');
  const serviceability = runner(
    opts,
    'shipping.refresh-serviceability',
    '/shipping/internal/refresh-serviceability',
  );
  const payouts = runner(opts, 'settlement.run-payouts', '/settlement/internal/run-payouts');
  const interval = setInterval(() => void tracking(), opts.trackingIntervalMs);
  // Refresh once at boot so estimates use courier data without waiting for the night.
  void serviceability();
  const stops = [
    () => clearInterval(interval),
    daily(serviceability, opts.serviceabilityHourIst),
    daily(payouts, opts.payoutHourIst),
  ];
  return () => stops.forEach((s) => s());
}
