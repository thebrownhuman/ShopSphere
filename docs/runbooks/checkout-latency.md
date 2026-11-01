# CheckoutLatencyP99High

**Fires:** p99 of `/checkout*` routes (create, patch, place order) above 1 s over 5 minutes, for
5 minutes. **Severity:** page (checkout). Place-order locks offer rows, so slowness compounds
under contention.

## 1. Which step

- Grafana → **Checkout latency p95 / p99**, **p95 latency by route**.
- `histogram_quantile(0.99, sum by (le, route) (rate(http_request_duration_seconds_bucket{route=~"/checkout.*"}[5m])))`

## 2. Causes

| Signal | Cause | Action |
|---|---|---|
| `place-order` only, one hot SKU | Lock contention on one offer (flash sale) | Expected at the hot item; turn on the waiting room. |
| All checkout routes | Database slow | `pg_stat_activity` waits; slow statements in the Postgres log (`log_min_duration_statement`); `EXPLAIN (ANALYZE, BUFFERS)`; add indexes in a migration (example: `20261103100000_perf_indexes`). On Docker Desktop, `COMMIT` > 100 ms means disk fsync is the limit. |
| Latency without DB load, `P2024` in logs | Pool too small for the instance's concurrency | Raise `DATABASE_POOL_SIZE` within Postgres `max_connections`, or add instances. |

## 3. Mitigate now

1. Waiting room on ([api-5xx-rate.md](api-5xx-rate.md)).
2. Scale API instances if CPU-bound.
3. After the fix, rerun the load test (`docs/perf/load-test.md`) and compare per-route p99.
