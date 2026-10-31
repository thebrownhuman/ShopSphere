# ShopSphere

Simulated Flipkart-style multi-vendor marketplace (INR, amounts in integer paise). See
`PRD — ShopSphere E-commerce Website.md` and `ShopSphere — Implementation Plan.md`.

## Layout

```
apps/web        customer site (Next.js 15, Tailwind, TanStack Query)
apps/seller     Seller Central (placeholder, M5)
apps/admin      admin console (placeholder, M6)
apps/api        NestJS modular monolith + Prisma (src/modules/*)
apps/workers    BullMQ workers (placeholder)
packages/ui     shared design system
packages/types  shared DTOs
packages/config shared ESLint / tsconfig / Tailwind preset
infra/          docker-compose (Postgres 16, Redis 7, OpenSearch, Mailpit, S3 via SeaweedFS)
```

## Dev setup

Requires Node 22+, Docker, and pnpm 9 (`corepack enable` or `npm i -g pnpm@9`).

```bash
pnpm install
pnpm infra:up                         # start Postgres, Redis, OpenSearch, Mailpit, S3
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm db:migrate                       # apply Prisma migrations
pnpm db:seed
pnpm --filter @shopsphere/api dev     # API on http://localhost:4000/healthz
pnpm --filter @shopsphere/web dev     # web on http://localhost:3000
```

Local consoles: Mailpit http://localhost:8025, S3 endpoint http://localhost:8333,
OpenSearch http://localhost:9200.

If 5432/6379 are taken, set `POSTGRES_PORT` / `REDIS_PORT` before `infra:up` and update `DATABASE_URL` / `REDIS_URL`
in `apps/api/.env`.

## Checks (same as CI)

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## API building blocks (`apps/api/src/modules/shared`)

| Block | Use |
| --- | --- |
| `config` | zod-validated env; boot fails on invalid config |
| `errors` | every error renders as `{ code, message, details }`; throw `AppError` from modules |
| `request-id` | `X-Request-Id` reused or minted, echoed on response |
| `rate-limit` | global Redis fixed-window guard; `@RateLimit({limit, windowSeconds})`, `@SkipRateLimit()` |
| `idempotency` | `@Idempotent()` routes need `Idempotency-Key`; first response replayed, body mismatch → 422 |
| `outbox` | `OutboxService.enqueue(tx, event)` inside the domain transaction; `OutboxPublisher` relays (stub) |
| `audit` | `AuditService.record(entry, tx?)` append-only audit log |
| `events` | `ProcessedEventsService.runOnce(consumer, eventId, handler)` for idempotent consumers |

## Conventions

Conventional Commits; money as integer paise (`BIGINT`); all timestamps `timestamptz` UTC; modules talk
through service APIs and outbox events, never each other's tables. Payments sit behind a
`PaymentProvider` adapter (Razorpay test mode, ShopSphere Bank).

## Milestone 0 status

Done: M0.1, M0.2 (no Kafka, BullMQ for MVP; SeaweedFS instead of MinIO), M0.3, M0.4, M0.5 (hand-written fetch client until the
OpenAPI spec exists), M0.7 (no Docker image build yet), M0.11, M0.15.

TODO: M0.6 design system components, M0.8 Terraform, M0.9 CD, M0.10 observability, M0.12 feature
flags, M0.13 long-lead business items, M0.14 analytics pipeline, OpenAPI-generated client, Docker images in CI.

## Milestone 1 status (identity)

Done: M1.1–M1.14 except where noted. Module: `apps/api/src/modules/identity`; pages: `/signin`,
`/account`, `/account/security`, `/account/addresses`.

- OTP (6 digits, 5-min TTL, 5 attempts, 30 s resend) via `NotificationProvider`; the dev provider logs
  the code and delivers to Mailpit. Phone OTPs land in `sms-91XXXXXXXXXX@sms.shopsphere.test`.
- Access JWT 15 min (memory only); rotating refresh token in HttpOnly `ss_rt` (30 days with "keep me
  signed in", else a browser-session cookie capped at 12 h). Reusing a spent refresh token revokes the
  session family.
- CAPTCHA (Turnstile test keys) after 5 failed logins per account or IP in 15 min; lockout + new-device
  alerts; TOTP 2FA; step-up re-auth (10 min) for password/email/phone/2FA changes.
- CSRF: double-submit `ss_csrf` cookie + `x-csrf-token` header on cookie-authenticated `/auth/*`;
  bearer-authenticated mutations need none. SSR reads the signed `ss_session` cookie
  (`SESSION_COOKIE_SECRET` must match in api and web).
- Google sign-in is wired but disabled until `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are set.

Not yet: guest-cart merge on sign-in (needs M3 cart), real SMS/SES adapters, full India Post pincode
data (seed has a sample), TOTP secret encryption at rest, Delete account (DPDP).

E2E (needs `pnpm infra:up`; uses its own `shopsphere_e2e` database and ports 4200/3100):

```bash
pnpm --filter @shopsphere/web exec playwright install chromium
pnpm --filter @shopsphere/web test:e2e
# non-default compose ports: E2E_DATABASE_URL=postgresql://shopsphere:shopsphere@localhost:5440/shopsphere_e2e E2E_REDIS_URL=redis://localhost:6390/5
```
## Milestone 2 backend (catalog, search, home)

Done: M2.1–M2.12, M2.15, M2.21 (backend), M2.24. Modules: `apps/api/src/modules/{catalog,search,pricing,delivery,home}`;
workers: `apps/workers/src/{search,images}`. Contract types: `packages/types/src/catalog.ts`.

| Endpoint | Notes |
| --- | --- |
| `GET /home` | CMS rows from `home_sections`, filtered by audience (guest / signed-in) and time window; personalised rows use the bearer token or `X-Guest-Id` |
| `GET /categories` | tree from the materialized-path `categories` table |
| `GET /products/:slug?sku=` | content, variants, per-SKU buy-box, also-viewed |
| `GET /products/:id/offers?sku=` | live offers, buy-box first (`no-store`) |
| `GET /delivery-estimate?sku&pincode[&offerId]` | zone stub on pincode prefixes, IST cutoff countdown, no Sunday delivery |
| `GET /search`, `GET /search/suggest`, `POST /search/click` | OpenSearch; filters `category, brand, minPrice, maxPrice, rating, discount, plus, inStock, attr.<key>`; analytics in `search_events` |
| `GET/POST /recently-viewed` | last 20 per user / guest; first views feed `co_views` |

- Buy-box v1: `0.60 × cheapest/price + 0.25 × rating/5 + 0.15 × fastestSLA/SLA`, ties go to first party.
- Prices are GST inclusive; the GST rate is per category (basis points, inherited from the parent).
- Sellers include ShopSphere's own fulfilment centres (`is_first_party`, "Fulfilled by ShopSphere").
- Indexer: catalog writes enqueue `product.changed` / `offer.changed` in the outbox; the worker calls
  `POST /search/internal/index` every 2 s. Stock-only changes are debounced (one reindex per product per 60 s).
  Full rebuild: `POST /search/internal/reindex-all` (both need `x-internal-token`).
- Images: the seed uses generated SVG placeholders served by `GET /media/ph/:seed`. Uploaded originals
  (`product_images.status = PENDING`) are rendered to WebP/AVIF at 100/300/600/1200 px by the image worker (sharp → S3).
- Seed: `pnpm db:seed` loads 42 categories and ~5,000 products (~12 s including indexing). `SEED_RESET=1` rebuilds,
  `SEED_PRODUCTS=n` resizes, `SEED_REINDEX=1` only rebuilds the index.
- Search integration test (needs OpenSearch from docker-compose): `pnpm --filter @shopsphere/api test:int`.

TODO: phonetic analyzer (needs the analysis-phonetic plugin), seller image upload API (M5), BullMQ instead of
interval schedulers.

## Payments (M4.10–M4.18 foundation, ahead of checkout)

`apps/api/src/modules/payment` + `apps/bank-sim` (see its README for test cards and protocol).

- Providers behind `PaymentProvider`: `bank` (ShopSphere Bank simulator, always on) and `razorpay`
  (test mode; enabled only when `RAZORPAY_KEY_ID` (`rzp_test_…`), `RAZORPAY_KEY_SECRET` and
  `RAZORPAY_WEBHOOK_SECRET` are set; point the Razorpay dashboard webhook at
  `<public api url>/payments/webhooks/razorpay`, e.g. via a tunnel).
- Routes: `POST /payments/:orderId/initiate` (Idempotency-Key), `POST /payments/:orderId/verify`,
  `GET /payments/:orderId/status`, `POST /payments/webhooks/:provider`, internal (`x-internal-token`):
  `POST /payments/:orderId/refunds`, `POST /payments/internal/reconcile`. Dev only: `POST /payments/dev/orders`.
- Orders come from `PayableOrderSource`; `StubOrderSource` (in memory) stands in until the orders module.
- Paid only on a verified webhook / reconciliation fetch; events stored once in `webhook_events`; first
  capture wins (`order_payment_captures`), later captures auto-refunded; reconciliation runs from
  `apps/workers` every 5 min.

Try it: `pnpm --filter @shopsphere/bank-sim dev`, run the API and web, open http://localhost:3000/dev/pay.
