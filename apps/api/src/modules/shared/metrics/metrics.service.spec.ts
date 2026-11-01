import { MetricsService } from './metrics.service';
import { pooledUrl } from '../prisma/prisma.service';

describe('MetricsService', () => {
  it('renders counters, cumulative histogram buckets and scrape-time gauges', async () => {
    const m = new MetricsService();
    m.httpRequests.inc({ method: 'GET', route: '/home', status: '200' });
    m.httpRequests.inc({ method: 'GET', route: '/home', status: '200' });
    m.httpDuration.observe({ method: 'GET', route: '/home' }, 0.03);
    m.httpDuration.observe({ method: 'GET', route: '/home' }, 2);
    m.gauge('queue_depth', 'Depth', () => Promise.resolve([{ value: 7 }]));
    const text = await m.render();
    expect(text).toContain('http_requests_total{method="GET",route="/home",status="200"} 2');
    expect(text).toContain(
      'http_request_duration_seconds_bucket{method="GET",route="/home",le="0.05"} 1',
    );
    expect(text).toContain(
      'http_request_duration_seconds_bucket{method="GET",route="/home",le="2.5"} 2',
    );
    expect(text).toContain(
      'http_request_duration_seconds_bucket{method="GET",route="/home",le="+Inf"} 2',
    );
    expect(text).toContain('http_request_duration_seconds_count{method="GET",route="/home"} 2');
    expect(text).toContain('# TYPE queue_depth gauge\nqueue_depth 7');
  });

  it('escapes label values', async () => {
    const m = new MetricsService();
    m.cache.inc({ name: 'a"b\\c', result: 'hit' });
    expect(await m.render()).toContain('cache_requests_total{name="a\\"b\\\\c",result="hit"} 1');
  });
});

describe('pooledUrl', () => {
  const base = 'postgresql://u:p@localhost:5432/db?schema=public';
  it('adds pool settings from env', () => {
    const url = new URL(
      pooledUrl(base, { DATABASE_POOL_SIZE: '40', DATABASE_POOL_TIMEOUT_S: '5' })!,
    );
    expect(url.searchParams.get('connection_limit')).toBe('40');
    expect(url.searchParams.get('pool_timeout')).toBe('5');
    expect(url.searchParams.get('schema')).toBe('public');
  });
  it('leaves an explicit connection_limit alone', () => {
    const url = new URL(pooledUrl(`${base}&connection_limit=3`, { DATABASE_POOL_SIZE: '40' })!);
    expect(url.searchParams.get('connection_limit')).toBe('3');
  });
  it('is a no-op without env', () => {
    expect(pooledUrl(base, {})).toBe(base);
  });
});
