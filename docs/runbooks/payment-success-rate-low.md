# PaymentSuccessRateLow

**Fires:** fewer than 90 % of payment outcomes in the last 5 minutes are captures (at least 10
outcomes), for 1 minute. **Severity:** page (payments). Shoppers fail to pay: lost orders.

## 1. Confirm and size it

- Grafana *Payments & Checkout* → **Payment success rate**, **Payment outcomes/min**.
- Prometheus: `sum by (provider, outcome) (increase(payment_outcomes_total[5m]))` — one
  provider or all?
- At low volume (night) a few genuine declines can trip it; 10 outcomes is the floor. If the
  failures are ordinary declines, ack and watch.

## 2. Find the cause

Breakdown of recent failures:

```sql
SELECT provider, method, error_reason, count(*)
FROM payment_attempts
WHERE created_at > now() - interval '15 minutes' AND status = 'FAILED'
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```

| Signal | Likely cause | Action |
|---|---|---|
| One provider only | Gateway / bank incident | Check the provider status page (Razorpay) or bank-sim `/dev`. Steer shoppers to the healthy provider (disable the broken one in config, redeploy). |
| One issuer / UPI PSP dominates `error_reason` | Issuer or PSP outage | Banner on the payment step; nothing to fix on our side. |
| Started right after a deploy | Our bug (amount mismatch, signature) | Look for `AMOUNT_MISMATCH` attempts and API errors; roll back. |
| Many `CAPTURED_REFUNDED` | Orders expired before capture | See [payment-webhook-lag.md](payment-webhook-lag.md). |

Local simulation: ShopSphere Bank declines on purpose for UPI `failure@ssb`, card
`4000000000000002` and the net-banking users listed on `/dev`. The k6 journey with
`VPA=failure@ssb` reproduces this alert (see `docs/perf/load-test.md`, alert drill).

## 3. Resolve

Resolves by itself once the 5-minute ratio is back above 90 %. Record window, failed count,
provider and cause. Unpaid orders expire and release stock after the pay window; nothing to
clean up by hand.
