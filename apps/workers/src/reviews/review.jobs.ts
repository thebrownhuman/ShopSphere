import type { ReviewSummaryWrite, SummaryCandidate } from '@shopsphere/types';
import {
  OfflineSummarizer,
  summarizerFromEnv,
  type ReviewSummarizer,
  type SummaryOutput,
} from './summarizer';

/**
 * Review jobs (M6.2, M6.4). Like the other schedulers these only call internal API endpoints.
 *
 *   reviews.refresh-aggregates  every REVIEW_AGGREGATE_INTERVAL_MS (1 min): drains the rating
 *                               aggregate queue (products.rating_x10/count + search index)
 *   reviews.summaries           every REVIEW_SUMMARY_INTERVAL_MS (30 min): regenerates cached
 *                               summaries whose review count changed
 */
export interface ReviewJobOptions {
  apiUrl: string;
  internalToken: string;
  aggregateIntervalMs: number;
  summaryIntervalMs: number;
  summaryBatch: number;
  summarizer: ReviewSummarizer;
}

export function reviewOptionsFromEnv(env: NodeJS.ProcessEnv): ReviewJobOptions {
  return {
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    internalToken: env.CATALOG_INTERNAL_TOKEN ?? 'dev-internal-token-change-me',
    aggregateIntervalMs: Number(env.REVIEW_AGGREGATE_INTERVAL_MS ?? 60_000),
    summaryIntervalMs: Number(env.REVIEW_SUMMARY_INTERVAL_MS ?? 30 * 60_000),
    summaryBatch: Number(env.REVIEW_SUMMARY_BATCH ?? 20),
    summarizer: summarizerFromEnv(env),
  };
}

const log = (level: 'info' | 'warn', msg: string, extra: Record<string, unknown> = {}) =>
  console.log(
    JSON.stringify({ level, msg, job: 'reviews', time: new Date().toISOString(), ...extra }),
  );

async function api(
  opts: ReviewJobOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${opts.apiUrl}${path}`, {
    method,
    headers: { 'x-internal-token': opts.internalToken, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const parsed: unknown = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(`${method} ${path} failed (${res.status}): ${JSON.stringify(parsed)}`);
  return parsed;
}

const offline = new OfflineSummarizer();

/** Summarises one product; if the configured summarizer fails, the offline one fills in. */
export async function summarizeCandidate(
  summarizer: ReviewSummarizer,
  c: SummaryCandidate,
): Promise<ReviewSummaryWrite> {
  let out: SummaryOutput;
  try {
    out = await summarizer.summarize({ productTitle: c.productTitle, reviews: c.reviews });
  } catch (e) {
    log('warn', 'summarizer failed, using offline fallback', {
      productId: c.productId,
      error: String(e),
    });
    out = await offline.summarize({ productTitle: c.productTitle, reviews: c.reviews });
  }
  return { ...out, reviewCount: c.reviewCount };
}

export async function runSummaryBatch(opts: ReviewJobOptions): Promise<number> {
  const candidates = (await api(
    opts,
    'GET',
    `/reviews/internal/summary-candidates?limit=${opts.summaryBatch}`,
  )) as SummaryCandidate[];
  for (const c of candidates) {
    const write = await summarizeCandidate(opts.summarizer, c);
    await api(opts, 'PUT', `/reviews/internal/summaries/${c.productId}`, write);
  }
  return candidates.length;
}

/** Interval runner: overlapping runs are skipped and failures are logged, never thrown. */
function every(ms: number, job: string, fn: () => Promise<unknown>): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    fn()
      .then((result) => log('info', `${job} done`, { result }))
      .catch((e: unknown) => log('warn', `${job} failed`, { error: String(e) }))
      .finally(() => {
        running = false;
      });
  }, ms);
  return () => clearInterval(timer);
}

export function startReviewJobs(opts: ReviewJobOptions): () => void {
  const stops = [
    every(opts.aggregateIntervalMs, 'reviews.refresh-aggregates', () =>
      api(opts, 'POST', '/reviews/internal/refresh-aggregates'),
    ),
    every(opts.summaryIntervalMs, 'reviews.summaries', () => runSummaryBatch(opts)),
  ];
  return () => stops.forEach((s) => s());
}
