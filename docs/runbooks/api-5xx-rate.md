# Api5xxRateHigh

**Fires:** more than 2 % of API requests answer 5xx over 5 minutes (with at least 0.2 req/s),
for 2 minutes. **Severity:** page (platform).

## 1. Where

- Prometheus: `topk(10, sum by (route, status) (rate(http_requests_total{status=~"5.."}[5m])))`.
- One route or everything? Everything usually means a dependency is down.
- `GET /healthz` reports `db` and `redis`.

## 2. Usual causes

| Signal | Cause | Action |
|---|---|---|
| All routes, `/healthz` db down | Postgres down or out of connections | `docker compose ps postgres`; compare `SELECT count(*) FROM pg_stat_activity` with `max_connections`. Each API instance holds up to `DATABASE_POOL_SIZE` (40 in the load test) connections. |
| `P2024` "Timed out fetching a new connection" in logs | Prisma pool exhausted | Long transactions (`idle in transaction` in `pg_stat_activity`) or overload: scale API instances or turn on the waiting room. |
| Redis down | Cache and rate limit fail open; sessions/OTP fail | Restart Redis. |
| `/search`, `/home` only | OpenSearch down | Restart; reindex via `POST /search/internal/reindex-all`. |
| Right after a deploy | Regression | Roll back. |

## 3. Waiting room

Caps how fast shoppers enter checkout (token bucket, FIFO). Queued shoppers get 429
`WAITING_ROOM`, which does not count towards this alert. Toggle at runtime:

```bash
curl -X POST -H "x-internal-token: $PAYMENT_INTERNAL_TOKEN" -H 'content-type: application/json' \
  -d '{"state":"on"}' $API/waiting-room/internal/flag     # "off", or "env" to follow WAITING_ROOM_ENABLED
```

Rate/burst: `WAITING_ROOM_RATE_PER_SEC` (default 20), `WAITING_ROOM_BURST` (50).
