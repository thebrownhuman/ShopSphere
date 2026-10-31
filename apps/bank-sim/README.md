# ShopSphere Bank (simulator)

The owner's own bank gateway, simulated. It speaks Razorpay's protocol so ShopSphere uses one
adapter for both (`apps/api/src/modules/payment/providers/razorpay-compatible.provider.ts`).
State is in memory and resets on restart.

```bash
pnpm --filter @shopsphere/bank-sim dev      # http://localhost:4100, dev console /dev
# or: docker compose -f infra/docker-compose.yml up -d bank-sim
```

## Protocol

| Step | What |
| --- | --- |
| Merchant API | HTTP Basic `key_id:key_secret`. `POST /v1/orders {amount, currency, receipt}` (honours `Idempotency-Key`), `GET /v1/orders/:id`, `GET /v1/orders/:id/payments`, `GET /v1/payments/:id`, `POST /v1/payments/:id/capture {amount}`, `POST /v1/payments/:id/refund {amount}` (honours `Idempotency-Key`), `POST /v1/payouts {amount, reference_id, narration, fund_account: {name, account_number, ifsc}}` (seller payouts, M5.7; settles instantly with a `utr`, account numbers ending `0000` are `rejected`; honours `Idempotency-Key`), `GET /v1/payouts/:id`. Errors: `{error: {code, description}}`. |
| Hosted checkout | `GET /checkout?order_id&key_id&callback_url`. Card (Luhn + expiry + CVV, then 3-D Secure OTP), net banking login, or UPI. Card data is only ever entered here. |
| Redirect back | `303` to `callback_url?payment_id&order_id&signature`, signature = hex HMAC-SHA256(key_secret, `order_id\|payment_id`). Failures carry `error_code`, `error_description` instead. `callback_url` origin must be in `ALLOWED_CALLBACK_ORIGINS`. |
| Webhooks | `POST WEBHOOK_URL`, body like Razorpay's (`event`, `payload.payment.entity`), headers `x-bank-signature` = hex HMAC-SHA256(webhook_secret, raw body) and `x-bank-event-id`. Events: `payment.authorized`, `payment.captured`, `payment.failed`, `refund.processed`. Retried 5× with backoff on non-2xx. |

## Test controls

OTP `123456` (anything else fails 3-D Secure). Any future expiry, any CVV.

| Card | Result |
| --- | --- |
| 4111 1111 1111 1111 (Visa debit), 5555 5555 5555 4444 (MC credit), 6080 0000 0000 0000 (RuPay) | captured |
| 4000 0000 0000 0002 | declined |
| 4000 0000 0000 0010 | pending until resolved in `/dev` |
| 4000 0000 0000 0028 | late capture after `LATE_CAPTURE_DELAY_MS` (default 20 s) |
| 4000 0000 0000 0036 | charged twice (two captures, tests first-capture-wins refund) |
| 4000 0000 0000 0044 | authorized only; merchant (reconciliation) must capture |

UPI: `success@ssb`, `failure@ssb`, `pending@ssb`, `late@ssb`; any other VPA succeeds. Net banking customer
ID `fail` / `pending` / `late`; anything else succeeds.

`/dev` lists payments (resolve pending: capture / fail) and webhook deliveries (replay with the same event
id to test receiver idempotency).

Env: see `.env.example`. Defaults match the API's `BANK_*` defaults.
