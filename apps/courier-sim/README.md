# ShopSphere Courier (simulator)

A simulated 3PL (Shiprocket/Delhivery-like) for M5.6. ShopSphere talks to it through the
`CourierProvider` adapter (`apps/api/src/modules/shipping/providers`). State is in memory.

```bash
pnpm --filter @shopsphere/courier-sim dev   # http://localhost:4500
# or: docker compose -f infra/docker-compose.yml up -d courier-sim
```

| Endpoint (`x-api-key` header)                                                                                 | What                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/serviceability/matrix`                                                                               | Lane rules: metro prefixes, remote/unserviceable patterns, SLA days and rate card per zone. Pulled nightly by the API (M5.6a). |
| `GET /v1/serviceability?from=&to=` / `POST /v1/rates {fromPincode,toPincode,weightGrams,cod}`                 | Zone, SLA, rate in paise.                                                                                                      |
| `POST /v1/shipments {reference, fromPincode, toPincode, weightGrams, cod, codAmountPaise, consignee, sender}` | Books a shipment, returns `awb`. Idempotent on `reference`.                                                                    |
| `GET /v1/shipments/:awb` / `.../label`                                                                        | Tracking / A6 label PDF.                                                                                                       |
| `POST /v1/shipments/:awb/advance`                                                                             | Dev: next tracking step now.                                                                                                   |
| `POST /v1/shipments/:awb/replay`                                                                              | Dev: re-send all webhooks for the AWB (duplicate testing).                                                                     |

Tracking: `MANIFESTED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`, one step every `STEP_MS`
(default 30 s; `AUTO_ADVANCE=false` to step manually). Each step POSTs `WEBHOOK_URL` with
`{eventId, awb, reference, status, sequence, location, occurredAt}`, headers
`x-courier-signature` = hex HMAC-SHA256(`WEBHOOK_SECRET`, raw body) and `x-courier-event-id`;
retried 5× with backoff on non-2xx.

Env: `PORT` (4500), `COURIER_API_KEY` (`cs_test_api_key`), `WEBHOOK_SECRET`
(`cs_test_webhook_secret`), `WEBHOOK_URL`, `STEP_MS`, `AUTO_ADVANCE`.
