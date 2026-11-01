# Runbooks (M7.7)

One page per alert in `infra/prometheus/alerts.yml`. Alerts go Prometheus → Alertmanager →
email. Locally the email lands in Mailpit (http://localhost:8025, to `oncall@shopsphere.test`);
in a deployed environment swap the Alertmanager receiver for PagerDuty/Slack.

| Alert | Fires when | Runbook |
|---|---|---|
| `PaymentSuccessRateLow` | captures / (captures + failures) < 90 % over 5 min, ≥ 10 outcomes, for 1 min | [payment-success-rate-low.md](payment-success-rate-low.md) |
| `PaymentWebhookLagHigh` | oldest attempt waiting for its webhook > 2 min, or p95 webhook lag > 2 min, for 1 min | [payment-webhook-lag.md](payment-webhook-lag.md) |
| `Api5xxRateHigh` | 5xx > 2 % of requests over 5 min (and > 0.2 req/s), for 2 min | [api-5xx-rate.md](api-5xx-rate.md) |
| `CheckoutLatencyP99High` | p99 of `/checkout*` routes > 1 s over 5 min, for 5 min | [checkout-latency.md](checkout-latency.md) |

## Where to look

- Start: `docker compose -f infra/docker-compose.yml --profile observability up -d`
- Grafana: http://localhost:3300 → folder **ShopSphere** → *Payments & Checkout* (provisioned
  from `infra/grafana/dashboards/shopsphere-ops.json`; edit the JSON, not the UI).
- Prometheus: http://localhost:9090/alerts. Alertmanager: http://localhost:9093 (silences).
- Raw metrics: `GET /metrics` on the API (`apps/api/src/modules/shared/metrics`).
- Bank-sim dev console: http://localhost:4100/dev (payments, webhook deliveries, replay).
- API error bodies carry `code`; responses carry `x-request-id`.

## Metrics reference

| Metric | Type | Meaning |
|---|---|---|
| `http_requests_total{method,route,status}` | counter | every request; `route` is the matched pattern (`/checkout/:id`) |
| `http_request_duration_seconds{method,route}` | histogram | request latency |
| `payment_outcomes_total{provider,type,outcome}` | counter | webhook results: `CAPTURED`, `FAILED`, `CAPTURED_REFUNDED`, `DUPLICATE_EVENT`, … |
| `payment_webhook_lag_seconds{provider}` | histogram | gateway `created_at` → webhook received |
| `payment_webhook_backlog_oldest_seconds` | gauge | age of the oldest `AUTHORIZED` attempt (shopper returned, no webhook yet) |
| `cache_requests_total{name,result}` | counter | Redis read-through cache (`home-sections`, `home-query`, `pdp`) |
| `waiting_room_decisions_total{decision}` | counter | sale-day queue (`admitted` / `queued`) |

`/metrics` is unauthenticated for local scraping. In a deployed environment expose it only on
the internal network (or behind the ingress allow-list) — it reveals route names and volumes.
