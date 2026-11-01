import { Injectable } from '@nestjs/common';

/**
 * Minimal Prometheus registry (counters, histograms, scrape-time gauges) rendered in the text
 * exposition format at GET /metrics. Hand-rolled to avoid a dependency for four metric families.
 */
type Labels = Record<string, string>;

const DEFAULT_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function key(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');
}

class Counter {
  readonly values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }

  render(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values) out.push(`${this.name}${k ? `{${k}}` : ''} ${v}`);
    return out;
  }
}

class Histogram {
  private readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets = DEFAULT_BUCKETS,
  ) {}

  observe(labels: Labels, value: number): void {
    const k = key(labels);
    let s = this.series.get(k);
    if (!s) {
      s = { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
      this.series.set(k, s);
    }
    for (let i = 0; i < this.buckets.length; i++) if (value <= this.buckets[i]) s.counts[i]++;
    s.sum += value;
    s.count++;
  }

  render(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      const sep = k ? `${k},` : '';
      this.buckets.forEach((b, i) =>
        out.push(`${this.name}_bucket{${sep}le="${b}"} ${s.counts[i]}`),
      );
      out.push(`${this.name}_bucket{${sep}le="+Inf"} ${s.count}`);
      out.push(`${this.name}_sum${k ? `{${k}}` : ''} ${s.sum}`);
      out.push(`${this.name}_count${k ? `{${k}}` : ''} ${s.count}`);
    }
    return out;
  }
}

export interface GaugeSample {
  labels?: Labels;
  value: number;
}

@Injectable()
export class MetricsService {
  readonly httpRequests = new Counter('http_requests_total', 'HTTP requests by route and status');
  readonly httpDuration = new Histogram(
    'http_request_duration_seconds',
    'HTTP request latency by route',
  );
  readonly paymentOutcomes = new Counter(
    'payment_outcomes_total',
    'Payment webhook outcomes (CAPTURED, FAILED, ...) by provider',
  );
  readonly webhookLag = new Histogram(
    'payment_webhook_lag_seconds',
    'Gateway event creation to webhook receipt',
    [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 600],
  );
  readonly cache = new Counter('cache_requests_total', 'Read-through cache lookups by name/result');
  readonly waitingRoom = new Counter('waiting_room_decisions_total', 'Checkout admissions');

  private readonly gauges = new Map<string, { help: string; read: () => Promise<GaugeSample[]> }>();

  /** Gauges are computed at scrape time (e.g. from the database). */
  gauge(name: string, help: string, read: () => Promise<GaugeSample[]>): void {
    this.gauges.set(name, { help, read });
  }

  async render(): Promise<string> {
    const lines = [
      ...this.httpRequests.render(),
      ...this.httpDuration.render(),
      ...this.paymentOutcomes.render(),
      ...this.webhookLag.render(),
      ...this.cache.render(),
      ...this.waitingRoom.render(),
    ];
    for (const [name, g] of this.gauges) {
      lines.push(`# HELP ${name} ${g.help}`, `# TYPE ${name} gauge`);
      const samples = await g.read().catch(() => [] as GaugeSample[]);
      for (const s of samples) {
        const k = key(s.labels ?? {});
        lines.push(`${name}${k ? `{${k}}` : ''} ${s.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}
