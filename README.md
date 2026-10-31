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
