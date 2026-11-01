# Full-journey load test (M7.5)

Home → search → PDP (+ category tree) → add to cart → checkout (create, pay online, place order)
→ initiate payment → pay on ShopSphere Bank (bank-sim hosted page, UPI `success@ssb`) → verify
→ poll `GET /orders/:id/status` until `CONFIRMED`. Script: `infra/k6/journey.js`; fixture:
`apps/api/scripts/k6-journey.ts`; per-route table: `infra/k6/route_latency.py` (reads the API's
own histograms from Prometheus). Raw k6 summaries: `infra/k6/results/`.

## Load model — stated honestly

- **Expected peak: 20 concurrent shoppers.** M7.9 opens the beta to 1,000 invited users; we
  assume 2 % of them mid-journey at the busiest moment. A public-launch peak is unknown today and
  would be re-derived from beta analytics.
- **10× peak = 200 concurrent shoppers** (k6 VUs), each with 1–2 s think time between steps,
  ramping 0 → 20 (30 s) → hold 1 min → 200 (1 min) → hold (2 min in the baseline, 90 s in the
  A/B runs) → 0. That is **~150 HTTP req/s and ~10 paid orders/s (~35,000 orders/hour)**.
- Everything runs on **one Windows laptop**: one API process (Node, port 4310), bank-sim, k6 and
  the compose stack (Postgres 16, Redis, OpenSearch) under Docker Desktop, alongside other dev
  sessions. Absolute numbers are laptop numbers; the before/after comparison is the useful part.
  We could not go beyond 200 VUs meaningfully: k6 → Docker Desktop port proxy starts refusing
  connects (see "noise" below) before the API saturates.
- Data: catalog seed (4,994 products, 21k offers, 42 categories) plus the orders the runs
  themselves create (~24k by the end, so later runs face bigger tables than earlier ones).
- `RATE_LIMIT_PER_MINUTE` raised to 1,000,000 for the test: all VUs share one IP, and the
  per-IP limiter would otherwise be what we measure. Since M7.1 (merged after these runs)
  place-order has its own limit: also set `PLACE_ORDER_RATE_LIMIT_PER_MINUTE=1000000` when
  re-running, or every VU past the 20th order per minute gets 429.

## Results

A/B pair run back to back on 2026-11-01 under the same machine load; "before" = same build with
`CACHE_DISABLED=true`, `PAYMENT_EVENTS_PARALLEL=1`, no `DATABASE_POOL_SIZE`, perf indexes
dropped. HTTP latencies from k6 (client side, all requests):

| | before | after |
|---|---:|---:|
| HTTP p95 / p99 | 133 / 360 ms | **48 / 95 ms** |
| Checkout steps (`step:checkout`) p95 / p99 | 311 / 638 ms | **75 / 131 ms** |
| Paid → `CONFIRMED` (k6 `checkout_to_confirmed`) median / p90 | 1.75 / 5.56 s | **1.12 / 1.60 s** |
| Status polls per order (fewer = faster confirmation) | 5.1 | **2.6** |
| Orders confirmed | 2,709 (9.7/s) | 2,815 (9.9/s) |
| Failed journeys | 0 | 0 |
| `http_req_failed` | 0.11 % | 0.44 % (all bank-sim connects, see below) |

Server-side per route (API's own histogram, p95 / p99 ms):

| route | before p95 | before p99 | after p95 | after p99 |
|---|---:|---:|---:|---:|
| `GET /home` | 85 | 229 | 24 | 43 |
| `GET /search` | 123 | 236 | 42 | 69 |
| `GET /products/:slug` | 48 | 95 | 13 | 23 |
| `POST /cart/items` | 318 | 484 | 90 | 200 |
| `POST /checkout` | 284 | 469 | 70 | 100 |
| `PATCH /checkout/:id` | 232 | 456 | 55 | 94 |
| `POST /checkout/:id/place-order` | 479 | 905 | 122 | 228 |
| `POST /payments/:id/initiate` | 136 | 236 | 36 | 60 |
| `POST /payments/:id/verify` | 186 | 357 | 49 | 94 |
| `POST /payments/webhooks/:provider` | 262 | 473 | 80 | 155 |
| `GET /orders/:id/status` | 84 | 213 | 24 | 45 |

The checkout p99 < 1 s alert target holds with a wide margin after tuning (131 ms at 10× peak).

### Noise and what the p95/p99 tails of `checkout_to_confirmed` really are

- The ~31 s tail in `checkout_to_confirmed` / `journey_duration` (p95 in "after", p99 in both)
  is k6 failing to *connect* to bank-sim through Docker Desktop's port proxy
  (`dial: i/o timeout` on `POST :4115/checkout/pay`, 50 in "before", 169 in "after") and retrying
  after the 30 s dial timeout. The API never sees those requests; they are the only
  `http_req_failed` entries. A real gateway is not behind a laptop port proxy.
- The machine is shared with other sessions' builds and Playwright runs. An earlier "after" run
  at a busier moment (146 node processes) measured roughly 2× slower everywhere, including routes
  we did not touch. That is why the comparison above is an A/B pair taken minutes apart.
- First full baseline (2 min hold, before any change, quieter machine than the busy run):
  HTTP p95/p99 162/361 ms, checkout p95/p99 301/530 ms, place-order p99 842 ms,
  0 failed journeys, 2,908 orders (`infra/k6/results/baseline.txt`).

## What we found and fixed

1. **Missing foreign-key indexes** (`pg_stat_user_tables.seq_scan` + `EXPLAIN ANALYZE`): Prisma
   `include`s filter on `order_items.shipment_id`, `payment_attempts.payment_id`,
   `refunds.attempt_id`, `product_images.sku_id`, none indexed — every order confirmation and
   payment status read scanned the whole table (2,917 seq scans of `order_items` reading 4.4 M
   rows in one run). Migration `20261103100000_perf_indexes` adds them.
2. **Payment-events consumer re-read every handled event every second.** Its anti-join walked
   all `outbox_events` of the last 3 days (6.9 ms at 3k orders, linear in volume, per API
   instance, per second). Now: a partial index on payment outcomes and a watermark (oldest pending
   event − 5 min) so a tick reads only the recent tail.
3. **Confirmations were serial.** One event at a time capped confirmation throughput at
   ~12 orders/s; at 10× peak the webhook → `CONFIRMED` lag reached 15–50 s at the top of the
   ramp (measured in SQL: `orders.confirmed_at − webhook_events.received_at`). The consumer now
   handles up to `PAYMENT_EVENTS_PARALLEL` (default 8) orders at once, events of one order still
   in order. Median paid → confirmed dropped from 1.75 s to 1.12 s, p90 from 5.6 s to 1.6 s.
4. **Prisma pool.** The default pool is `2 × CPUs + 1` (33 on this 16-core laptop, 5 on a 2-vCPU
   container). `DATABASE_POOL_SIZE` / `DATABASE_POOL_TIMEOUT_S` now set it explicitly
   (`PrismaService`). **Our first choice, 20, was wrong**: with parallel confirmations, checkout
   transactions and 200 VUs it starved interactive transactions (`P2028 Unable to start a
   transaction in the given time`, 983 errors, p95 > 5 s — `infra/k6/results/after-pool20.txt`).
   **40** fixed it. Rule: instances × `DATABASE_POOL_SIZE` + workers must stay under Postgres
   `max_connections` (100 in compose).
5. **Redis caching for hot public reads** (`shared/cache/cache.service.ts`, read-through, single
   flight per key, `cache_requests_total` metric):
   - home CMS sections per audience (30 s) and the search-backed home rows (30 s, identical for
     every viewer; personal rows stay live),
   - PDP response (15 s; the route already allows clients 60 s; offers stay live at
     `/products/:id/offers` and checkout re-prices everything),
   - category tree: already cached in-process for 60 s (M2), left as is.
6. **N+1s**: the per-request query counts on the journey routes were already batched (product
   cards load with `findMany ... in`), so the big win was the unindexed relation loads in (1),
   which behaved like N+1 table scans.

Touched modules: `shared/{metrics,cache,prisma}`, `home/home.service.ts`,
`catalog/catalog.controller.ts`, `order/payment-events.consumer.ts`,
`payment/payment.service.ts` (metrics only), `checkout/checkout.{controller,module}.ts`
(waiting-room guard), new `waiting-room/`.

## Sale-day waiting room

`apps/api/src/modules/waiting-room`: FIFO queue drained by a Redis token bucket (one Lua script)
in front of `POST /checkout`. Shoppers who get in receive a pass (`WAITING_ROOM_PASS_TTL_SEC`,
default 15 min) so the rest of their checkout is never queued. Queued shoppers get **429**
`WAITING_ROOM` `{position, retryAfterSeconds}` + `Retry-After` (429 so a busy sale never trips the
5xx alert); the web app redirects to `/queue`, which polls `GET /waiting-room/status` and returns
to the same checkout URL when admitted.

Feature flag: `WAITING_ROOM_ENABLED` (env), overridden at runtime with
`POST /waiting-room/internal/flag {"state":"on"|"off"|"env"}` (`x-internal-token`). Rate/burst:
`WAITING_ROOM_RATE_PER_SEC` (20), `WAITING_ROOM_BURST` (50). Fails open if Redis is down.

Run at 10× peak with the flag on, 5 admissions/s, burst 10, 5 s passes (so the 200 looping
shoppers queue again on every order; `infra/k6/results/waiting-room.txt`):

- 3,662 queued answers, 892 admissions over ~4 min ≈ the configured 5/s once the burst is spent.
- Shoppers waited p50 29 s / p95 35 s in the queue; nobody failed or gave up.
- Checkout steps p99 364 ms — the API stays flat while demand is 2× the admission rate.

## Alert drill (M7.7, forced failures)

All four alerts fired on this stack (Prometheus scraping the load-test API on 4310):

| Alert | How it was forced | Fired (UTC, 2026-11-01) | Delivered |
|---|---|---|---|
| `PaymentSuccessRateLow` | k6 journey with `VPA=failure@ssb`, 5 VUs for 150 s: ShopSphere Bank declined all 125 payments | pending 20:07:51, firing 20:08:51; resolved 20:13 when the 5-min window emptied | Mailpit `[FIRING:1] PaymentSuccessRateLow` 20:09:06, `[RESOLVED]` 20:13:06 |
| `PaymentWebhookLagHigh` | bank-sim restarted with `WEBHOOK_URL=http://localhost:4999/dead`; 3 journeys paid + verified (attempts stay `AUTHORIZED`) | gauge crossed 120 s at ~20:11:20, firing 20:12:36 (value 208 s) | Mailpit `[FIRING:1] PaymentWebhookLagHigh` 20:12:51 |
| `Api5xxRateHigh` | organically, during the pool-20 run (P2028 transaction-start timeouts → 500s) | 15:58:35 – 16:00:35 | Mailpit was recreated later (no volume), so only Prometheus `ALERTS` history remains |
| `CheckoutLatencyP99High` | same run (checkout p99 > 10 s) | 16:00:35 | same |

The drill found a real bug: the success-rate rule divided `sum(captures)` by `sum(captures +
failures)`; with **zero** captures the numerator has no series, the division is empty and the
alert could never fire in a total outage. Fixed with `or vector(0)` (rule and dashboard).

## Reproduce

```bash
# stack + observability
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml --profile observability up -d
# API on 4310 against its own db (env as in the table above, plus DATABASE_POOL_SIZE=40)
# bank-sim on 4115 with WEBHOOK_URL=http://localhost:4310/payments/webhooks/bank
corepack pnpm --filter @shopsphere/api k6:journey 300     # tokens live 15 min: run k6 right after
docker run --rm --add-host host.docker.internal:host-gateway -v "$PWD/infra/k6:/k6" \
  -e PEAK=20 grafana/k6:1.3.0 run /k6/journey.js
python infra/k6/route_latency.py 6m
```

Postgres slow statements for profiling: `ALTER DATABASE <db> SET log_min_duration_statement = 100`
and read `docker logs shopsphere-postgres-1`. Disk note: on Docker Desktop single `COMMIT`s take
100–250 ms under load (WSL2 fsync); that, not query plans, is the remaining floor for
place-order.

## Not done / follow-ups

- One API process. Horizontal scale (2+ instances behind a load balancer) and running the
  payment-events consumer in `apps/workers` instead of in-process are the next steps before a
  public launch; the waiting room covers the gap meanwhile.
- `pg_stat_statements` is not enabled in compose (needs `shared_preload_libraries`, i.e. a
  Postgres restart of the shared container); profiling used the slow-query log + `EXPLAIN`.
