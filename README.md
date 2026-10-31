
## Milestone 4 backend (checkout, orders, inventory, coupons, ledger, GST)

Contract: `packages/types/src/checkout.ts` + `order.ts` (routes and error codes in the file headers).

- `POST /checkout` (cart or Buy Now), `GET|PATCH /checkout/:id` (address, delivery option per
  shipment, payment method, coupon, store balance), `POST /checkout/:id/place-order` (Idempotency-Key +
  `expectedTotalPaise`; a changed total answers 409 `PRICE_CHANGED`). Sessions expire 30 min after the
  last change. Every read re-prices from live offers.
- Shipments split per seller with STANDARD / ONE_DAY / SCHEDULED options; GST per line from the
  GST-inclusive price after coupon (CGST+SGST same state, IGST otherwise; seller state vs address).
- Stock: `inventory_reservations` + `offers.reserved_qty`, offers locked in id order; place-order
  reserves for 15 min (30 while a payment is pending), confirmation deducts, expiry releases.
- COD confirms at place-order (limit ₹50,000, pincode and fraud-score gates, ₹10 fee); orders fully
  paid by store balance confirm too. Online orders wait for the payment module's `payment.captured`
  outbox event, consumed by `order/payment-events.consumer.ts` (idempotent via `processed_events`).
- Late capture after expiry re-reserves and confirms, else `CANCELLED_NO_STOCK` + refund. Cancel
  (until SHIPPED) releases/restocks, returns store balance and coupon, refunds the capture.
- Coupons (`coupons`, `coupon_redemptions`: HELD → USED / RELEASED); closed-loop gift card / store
  balance double-entry ledger (`ledger_*`, `gift_cards`; `GET /store-balance`,
  `POST /store-balance/gift-cards/redeem`; no withdraw or transfer).
- `GET /orders`, `GET /orders/:id`, `GET /orders/:id/status`, `POST /orders/:id/cancel`; state machine
  in `order/order-state.ts`, history in `order_events`, outbox events `order.*` documented as
  `OrderEventPayloads` in `packages/types/src/order.ts`.
- QA toggle (non-production): `POST /orders/:id/test-payment {outcome: success|failure|pending|late_capture}`.
- Housekeeping (expiry, pending extension, refund retry) runs in-process every 30 s
  (`ORDER_WORKERS_ENABLED=false` to disable) and at `POST /orders/internal/sweep` (`x-internal-token`).

Tests: `apps/api/test/checkout.int.spec.ts` (real Postgres). Oversell load test (M4.33), API on 4210:

```bash
corepack pnpm --filter @shopsphere/api k6:setup 500 10
docker run --rm --add-host host.docker.internal:host-gateway -v "$PWD/infra/k6:/k6" -e API_URL=http://host.docker.internal:4210 grafana/k6:1.3.0 run /k6/checkout-oversell.js
corepack pnpm --filter @shopsphere/api k6:verify
```
