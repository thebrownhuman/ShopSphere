# PaymentWebhookLagHigh

**Fires:** a payment attempt has waited more than 2 minutes for its capture/failure webhook
(`payment_webhook_backlog_oldest_seconds > 120`), or p95 gateway-to-receipt lag is above
2 minutes, for 1 minute. **Severity:** page (payments). Shoppers have paid but their order still
says "confirming payment"; reservations can expire under them.

## 1. Confirm

- Grafana → **Webhook lag** panels; Prometheus `max(payment_webhook_backlog_oldest_seconds)`.
- Waiting attempts:
  `SELECT order_id, provider, created_at FROM payment_attempts WHERE status = 'AUTHORIZED' ORDER BY created_at LIMIT 20;`
- Last webhook per provider: `SELECT provider, max(received_at) FROM webhook_events GROUP BY 1;`

## 2. Find the cause

| Signal | Likely cause | Action |
|---|---|---|
| No webhooks at all for minutes | Gateway cannot reach us (DNS, TLS, firewall, wrong webhook URL) or is delayed | Gateway delivery log (bank-sim `/dev` → deliveries and their HTTP status). Fix the URL. |
| Webhooks answered 4xx | Signature secret mismatch after a rotation | Compare `BANK_WEBHOOK_SECRET` / `RAZORPAY_WEBHOOK_SECRET` with the gateway. |
| Webhooks answered 5xx / time out | API or DB trouble | [api-5xx-rate.md](api-5xx-rate.md). |
| Only p95 lag high, no backlog | Gateway retrying slowly | Gateway side; reconciliation covers it. |

## 3. Mitigate

- Reconcile now (polls the gateway for every open payment):
  `curl -X POST -H "x-internal-token: $PAYMENT_INTERNAL_TOKEN" $API/payments/internal/reconcile`
- Bank-sim: replay deliveries from `/dev`.
- Late captures are safe: an order that expired meanwhile re-reserves stock or is refunded
  (M4 late-capture path).

Local simulation: run bank-sim with `WEBHOOK_URL` pointing at a closed port, pay and verify; the
attempt stays `AUTHORIZED` and the alert fires after about 3 minutes (see
`docs/perf/load-test.md`, alert drill).
