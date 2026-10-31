## Milestone 6 returns, help centre, WhatsApp + web push

Contract: `packages/types/src/returns.ts` (routes in the file header). Migration
`20261101100000_returns_support_push` (`return_requests`, `return_tracking_events`,
`support_tickets`, `push_subscriptions`).

- Returns (M6.1, `apps/api/src/modules/returns`): order-level. `GET /orders/:id/return` gives
  eligibility (DELIVERED, inside the shortest window of the order's top-level categories:
  electronics/mobiles/books 7 days, fashion/home/other 10, grocery/beauty not returnable;
  `return-policy.ts`), pickup days and refund targets. `POST /orders/:id/return` moves the order
  `DELIVERED → RETURN_REQUESTED` and books a reverse pickup (customer → seller) through the active
  `CourierProvider`. Courier webhooks share `POST /shipping/webhooks/:provider` (AWBs that are not
  shipments are routed to returns): `SHIPPED` = picked up (order `→ PICKED_UP`), `DELIVERED` =
  received by the seller. Duplicates/stragglers are recorded with `applied=false`.
  Seller Central `/returns`: `GET /seller/returns`, `POST /seller/returns/:id/pickup` (re-book),
  `POST /seller/returns/:id/qc` — PASS restocks, refunds and moves the order `→ REFUNDED`:
  original method via `PaymentService.requestRefund` (store balance part back to the ledger), or the
  whole amount instantly to ShopSphere Pay balance if the shopper chose it (COD orders: balance only).
  The seller's settlement line is held (`RETURN_HOLD`) while the return is open and `REVERSED` on refund.
- Help centre + support (M6.8): `GET /help/articles?q=`, `GET /help/articles/:slug` (static content
  in `support/help-articles.ts`); `GET/POST /support/tickets` (optionally linked to an own order).
  Web: `/help`, `/help/:slug`, `/help/contact`.
- WhatsApp + web push (M6.9): notification channels gain `whatsapp` (simulated: Mailpit inbox
  `wa-<digits>@whatsapp.shopsphere.test`) and web push (`web-push`, VAPID). Preferences add
  `whatsapp` (opt-in, default off) and `push` per category. Set `VAPID_PUBLIC_KEY` /
  `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) to enable push; the web app registers
  `public/sw.js` from Account → Notifications (`/account/notifications`).

Tests: `apps/api/src/modules/returns/return-policy.spec.ts`, `notification.spec.ts`,
`apps/api/test/returns.int.spec.ts` (courier-sim + bank-sim in-process), and the Playwright E2E
`corepack pnpm --filter @shopsphere/web test:e2e:returns` (ports 4237/4137/4537/3157).

## Milestone 5 fulfilment (seller queue, courier, settlement)

Contract: `packages/types/src/fulfilment.ts` (routes in the file header). Seller routes need a user
with an APPROVED `seller_accounts` row (seller onboarding, M5.1).

- Seller queue (M5.5): `GET /seller/orders`, `POST /seller/orders/:shipmentId/{accept,pack,label}`,
  `GET /seller/shipments/:id` (tracking timeline), `GET /seller/shipments/:id/label.pdf`. Shipments go
  `CONFIRMED → ACCEPTED → PACKED → LABEL_CREATED`; the order becomes PACKED when every shipment is.
- Courier (M5.6): `apps/courier-sim` (port 4500) behind the `CourierProvider` adapter
  (`shipping/providers`; Shiprocket/Delhivery plug in there). Signed webhooks at
  `POST /shipping/webhooks/:provider` move shipments `SHIPPED → OUT_FOR_DELIVERY → DELIVERED`
  (forward-only; duplicates and stragglers are recorded with `applied=false`) and the order follows its
  slowest shipment through the M4 state machine, emitting `order.shipped`, `order.out_for_delivery`,
  `order.delivered`. `POST /shipping/internal/sync-tracking` polls for missed webhooks.
- Delivery estimate (M5.6a): uses the courier serviceability/SLA matrix stored by
  `POST /shipping/internal/refresh-serviceability` (nightly); built-in zone table until the first refresh.
- Settlement (M5.7): a `settlement_lines` row per delivered 3P shipment (commission 10%, shipping
  fee = courier cost − buyer delivery fee, 18% GST on fees, TCS 1% of taxable, TDS 0.1% of gross;
  `settlement/settlement-math.ts`). `POST /settlement/internal/run-payouts` (daily) pays lines due
  T+7 after delivery, one ShopSphere Bank payout (`bank-sim POST /v1/payouts`) per seller per batch.
  `GET /seller/payouts`, `GET /seller/payouts/:id`, `GET /seller/statements?from&to`.
- Workers: `apps/workers/src/fulfilment/fulfilment.jobs.ts` schedules the three internal calls.

Tests: `apps/api/test/fulfilment.int.spec.ts` boots courier-sim and bank-sim in-process:

```bash
corepack pnpm --filter @shopsphere/api exec jest test/fulfilment.int.spec.ts --testPathIgnorePatterns /node_modules/
```

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

## Milestone 5 seller side (Seller Central: onboarding, listings, inventory, dashboard)

Contract: `packages/types/src/seller.ts` (routes and error codes in the file header). Portal: `apps/seller`
(Next.js, port 3002; `NEXT_PUBLIC_API_URL`, add its origin to the API's `CORS_ORIGINS`).

- A seller is a user with a `seller_accounts` row (migration `20261031160000_seller`). KYC: PAN and GSTIN
  format + check digit, GSTIN must embed the PAN and match the pickup state; bank account via a
  simulated penny drop (`seller/penny-drop.ts`: account ending 0000 = no such account, 9999 = name
  mismatch). Only last 4 digits + a hash of the account number are stored.
- Approval queue: `GET /seller/admin/applications`, `POST .../:id/approve|reject` with
  `x-internal-token` (`CATALOG_INTERNAL_TOKEN`) until the admin console (M6). Approval creates the
  `sellers` row that offers and orders reference. Seed adds a first-party "ShopSphere Retail" account.
- Listings: form generated from `attribute_definitions` (nearest category wins), variants matrix,
  image upload (`POST /seller/media`, stored in `seller_media`, served at `GET /seller/media/:id`).
  New products are indexed into OpenSearch immediately (plus the usual `product.changed` outbox event).
- Bulk: CSV/XLSX template per category, one row per SKU, `group_id` groups variants, row-level report;
  `dryRun` validates only. Inventory table edits price/MRP/stock/status inline (stock never below reserved).
- Dashboard: sales/orders/returns from `order_items` by seller; `payouts` is null until settlements (M5.7).

```bash
DATABASE_URL=postgresql://shopsphere:shopsphere@localhost:5440/m5_seller corepack pnpm --filter @shopsphere/api test:int -- seller
corepack pnpm --filter @shopsphere/seller test:e2e   # API 4210, portal 3130, storefront 3140
```
