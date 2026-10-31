# ShopSphere — Implementation Plan

Oct 27, 2026 · @Shivansh Mishra

## 1. Approach

We build ShopSphere in 8 milestones over \~24 weeks, each ending in a working, demoable slice of the shopping journey (browse → cart → pay → order). Every task below is sized at 0.5–3 days for one developer and has a clear "done when".

**Principles**

- Start as a **modular monolith** (one deployable backend, strict module boundaries), split into services only when scale demands it. This cuts infra work for a small team while keeping the PRD's service boundaries.
- Vertical slices: each milestone ships DB → API → UI → tests together.
- Payments, stock and order state are server-authoritative and idempotent from day one.
- Every PR: typed, tested, reviewed, deployed to staging automatically.

**Suggested team (v1):** 1 tech lead, 3 backend (one dedicated to payments with the full-stack dev), 2 frontend, 1 full-stack (payments/integrations), 1 QA, 1 designer (part-time), 1 DevOps (part-time). A solo developer can follow the same order; multiply duration by \~4.

**Tech stack**

| Area | Choice |
| --- | --- |
| Monorepo | Turborepo + pnpm |
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query |
| Backend | NestJS (TypeScript) modular monolith — or Spring Boot if team prefers Java |
| DB | PostgreSQL 16 + Prisma; Redis 7; OpenSearch |
| Queue | BullMQ on Redis for MVP; move to managed Kafka (AWS MSK) only when event volume requires it |
| Payments | Razorpay (primary), adapter interface for Stripe/PayU |
| Infra | Docker, Kubernetes (EKS) or ECS, Terraform, GitHub Actions |

**Repo structure**

```
shopsphere/
  apps/
    web/            # customer site (Next.js)
    seller/         # Seller Central (Next.js)
    admin/          # Admin console (Next.js)
    api/            # NestJS backend
      src/modules/  # identity, catalog, search, pricing, inventory,
                    # cart, checkout, order, payment, notification,
                    # review, seller, admin, shared
    workers/        # webhooks, reconciliation, notifications, indexer
  packages/
    ui/             # shared design system
    types/          # shared DTOs / OpenAPI-generated client
    config/         # eslint, tsconfig, tailwind preset
  infra/            # terraform, k8s manifests, docker-compose
```

**Conventions:** trunk-based Git with short branches; Conventional Commits; OpenAPI spec as API contract; money stored as integer paise; all timestamps UTC; feature flags (Unleash/GrowthBook) for risky features.

## 2. Milestone 0 — Foundations (weeks 1–2)

Done when: a "hello world" page and API deploy automatically to staging on every merge, with logs, metrics and a shared design system.

- [ ] **M0.1** Create monorepo (Turborepo, pnpm), shared ESLint/Prettier/tsconfig — 0.5 d
- [ ] **M0.2** docker-compose for local dev: Postgres, Redis, OpenSearch, Kafka/Redpanda, Mailpit, MinIO (S3) — 1 d
- [ ] **M0.3** Scaffold NestJS API: config module, env validation (zod), health check `/healthz`, global error format `{code, message, details}` — 1 d
- [ ] **M0.4** Prisma setup + migration pipeline + seed script — 0.5 d
- [ ] **M0.5** Scaffold Next.js web app: layout, routing, TanStack Query, API client generated from OpenAPI — 1 d
- [ ] **M0.6** Design system v0 in `packages/ui`: colours, typography, Button, Input, Select, Modal, Drawer, Toast, Skeleton, Rating stars, Price — 3 d
- [ ] **M0.7** CI (GitHub Actions): lint, typecheck, unit tests, build, Docker images — 1 d
- [ ] **M0.8** Terraform: VPC, managed Postgres (RDS), Redis (ElastiCache), S3 + CloudFront, container cluster, secrets manager — 3 d
- [ ] **M0.9** CD to staging on merge to main; prod deploy on tag with manual approval — 1 d
- [ ] **M0.10** Observability: structured JSON logs, OpenTelemetry traces, Prometheus metrics, Grafana dashboards, Sentry for frontend/backend errors — 2 d
- [ ] **M0.11** Common backend building blocks: request ID, rate limiter (Redis), idempotency-key middleware, outbox table + publisher, audit-log helper — 2 d
- [ ] **M0.12** Feature-flag service wired in API and web — 0.5 d

**Added after architecture review**

- [ ] **M0.13** Week-0 long-lead items (owner: founder/ops, start before any code): register company, open current account, Razorpay merchant KYC, courier (3PL) contracts, SMS DLT sender-ID + template registration, domain and trademark check — runs 2–4 weeks in background
- [ ] **M0.14** Analytics pipeline: event SDK on web + API → collector → warehouse (BigQuery/ClickHouse) or PostHog; funnel dashboards for the PRD success metrics — 2 d
- [ ] **M0.15** Idempotent event-consumer helper: `processed_events (consumer, event_id) UNIQUE`; every worker uses it — 0.5 d

## 3. Milestone 1 — Identity and accounts (weeks 3–4)

Done when: a user can sign up and log in with OTP, password or Google, stay logged in for 30 days, and manage addresses.

**Backend**

- [ ] **M1.1** Tables: `users`, `user_identities` (email/phone/google), `sessions`, `refresh_tokens`, `otp_challenges`, `addresses` — 0.5 d
- [ ] **M1.2** OTP service: generate 6-digit code, hash + store with 5-min TTL in Redis, max 5 attempts, 30-s resend cooldown; SMS provider adapter (MSG91/Twilio) + email via SES — 2 d
- [ ] **M1.3** `POST /auth/otp/request`, `POST /auth/otp/verify` (creates user if new) — 1 d
- [ ] **M1.4** Password auth: Argon2id hashing, `POST /auth/login`, `POST /auth/password/forgot`, `/reset` — 1 d
- [ ] **M1.5** Google OAuth (OIDC) login + account linking by verified email — 1 d
- [ ] **M1.6** Tokens: 15-min JWT access token; rotating refresh token in HttpOnly cookie; reuse detection revokes session family; `POST /auth/refresh`, `/logout`, `/logout-all` — 2 d
- [ ] **M1.7** Rate limits + CAPTCHA (hCaptcha/Turnstile) after 5 failures; new-device login alert — 1 d
- [ ] **M1.8** Profile + address CRUD; pincode lookup table (city/state autofill, serviceable flag) — 1.5 d
- [ ] **M1.9** Optional TOTP 2FA and step-up re-auth for sensitive changes — 2 d

**Frontend**

- [ ] **M1.10** Sign-in page: identifier step → OTP or password step → name step for new users; return-to URL — 2 d
- [ ] **M1.11** Auth context, silent refresh, protected routes — 1 d
- [ ] **M1.12** "Your Account" hub + Login & Security + Addresses pages — 2 d

**Added after architecture review**

- [ ] **M1.13** Change email / phone: step-up re-auth, OTP to the new value, notify the old value, then swap — 1 d
- [ ] **M1.14** CSRF protection for cookie-authenticated endpoints (double-submit token on `/auth/refresh` and mutations) + a lightweight signed session cookie so SSR pages know logged-in state and name — 1.5 d

**Tests:** OTP brute-force limits, token rotation/reuse, session expiry, E2E sign-up with Playwright.

## 4. Milestone 2 — Catalog, search, home page, product page (weeks 5–9)

Done when: a shopper can land on the home page, search "headphones", filter by brand and price, open a product, switch variants and see live price, stock and delivery date for their pincode.

**2A. Catalog backend**

- [ ] **M2.1** Tables: `categories` (tree, materialized path), `brands`, `products` (parent), `skus` (variant: attributes JSON, barcode), `product_images`, `attribute_definitions` per category — 2 d
- [ ] **M2.2** `sellers` (stub) + `offers` (sku × seller: price, MRP, stock\_qty, max\_per\_order, fulfilment type, status) — 1 d
- [ ] **M2.3** Image pipeline: upload to S3 → resize worker (sharp) → WebP/AVIF in 4 sizes → CDN URLs — 2 d
- [ ] **M2.4** Seed realistic catalog: 20 categories, 5,000 products with images and specs (script) — 1.5 d
- [ ] **M2.5** Buy-box algorithm v1: pick winning offer by price + seller rating + delivery speed — 1 d
- [ ] **M2.6** Pricing module: MRP, selling price, discount %, GST rate per category, "incl. tax" display — 1 d
- [ ] **M2.7** Delivery estimate service: pincode × warehouse/seller location → zone → SLA days; cutoff time countdown. v1 is a stub zone table; switched to real courier serviceability in M5.6a — 2 d

**2B. Search**

- [ ] **M2.8** OpenSearch index mapping (title, brand, category path, attributes, price, rating, sales\_rank, in\_stock) with synonym + phonetic analyzers — 1.5 d
- [ ] **M2.9** Indexer worker: consumes `product.changed` / `offer.changed` events from outbox → partial reindex. Stock changes update only an in\_stock flag, debounced (max one reindex per SKU per 60 s); exact stock is always read from the DB — 2 d
- [ ] **M2.10** `GET /search?q&filters&sort&page` with faceted aggregations; ranking function (text score × sales × rating × stock boost) — 3 d
- [ ] **M2.11** `GET /search/suggest` autocomplete (edge n-grams + popular queries) — 1 d
- [ ] **M2.12** Search analytics events (query, results count, clicks) — 0.5 d

**2C. Frontend pages**

- [ ] **M2.13** Global header: logo, "Deliver to" pincode modal, category select + search box with autocomplete, account menu, cart icon with count — 3 d
- [ ] **M2.14** Mega-menu category nav + footer — 1.5 d
- [ ] **M2.15** Home page CMS model (`home_sections`: type, title, data source, order, audience) + `GET /home` — 2 d
- [ ] **M2.16** Home UI: hero carousel, quad cards, deal row with countdown, product carousels, recently viewed; lazy-loading + skeletons — 4 d
- [ ] **M2.17** Product tile component (image, title, rating, price, MRP, % off, delivery) — 1 d
- [ ] **M2.18** Search/listing page: filter rail (desktop) / bottom sheet (mobile), sort, pagination, URL-synced state, no-results view — 4 d
- [ ] **M2.19** Product page: gallery with zoom + full-screen, title/rating/price block, variant selectors (URL updates), bullets, specs table — 4 d
- [ ] **M2.20** Buy box: delivery date + countdown, stock message, qty select, Add to Cart / Buy Now (wired in M3), seller info, other sellers — 2 d
- [ ] **M2.21** Recently viewed + "customers also viewed" (co-view counts, simple v1) — 1.5 d
- [ ] **M2.22** SEO: SSR/ISR for home, category and PDP (price, stock and delivery date are always fetched live on the client with no-store, never served from the ISR cache); schema.org Product JSON-LD; sitemap.xml; canonical URLs; Open Graph tags — 2 d
- [ ] **M2.23** Performance pass: image priorities, font subsetting, bundle splitting; LCP < 2.5 s on throttled 4G in Lighthouse CI — 2 d

* [ ] **M2.24** Seed images: use licensed stock or generated images only, never scraped product photos — 0.5 d

**Reviews and Q&A** are scheduled in Milestone 6 (need delivered orders).

## 5. Milestone 3 — Cart and wishlist (weeks 10–11)

Done when: guests and users can add, update, remove and save items for later; the guest cart merges on login; totals are always computed on the server.

- [ ] **M3.1** Tables: `carts` (user\_id or guest\_token, status), `cart_items` (sku, offer, qty, price\_snapshot, added\_at), `saved_items`, `wishlists`, `wishlist_items` — 0.5 d
- [ ] **M3.2** Guest cart: signed `guest_cart` cookie (30 days) → server cart — 1 d
- [ ] **M3.3** `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id` with validations: active SKU, live offer, qty ≤ stock and per-order limit, serviceable pincode, max 50 lines — 2 d
- [ ] **M3.4** Cart pricing engine: line totals, subtotal, free-delivery threshold, price-change and stock-change flags vs. snapshot — 1.5 d
- [ ] **M3.5** Merge guest cart into user cart on login (sum qty, cap at limits) — 1 d
- [ ] **M3.6** Save for later / move to cart; wishlist CRUD — 1 d
- [ ] **M3.7** Add-to-cart button wired on PDP, tiles, deal rows; optimistic UI + rollback on error; header count animation — 1.5 d
- [ ] **M3.8** "Added to cart" side drawer with subtotal, checkout CTA, 3 add-on suggestions — 1.5 d
- [ ] **M3.9** Cart page: grouped lines, qty selector, delete, save for later, change banners, summary box with free-delivery progress bar, Proceed to Buy — 3 d
- [ ] **M3.10** Analytics events: add\_to\_cart, remove\_from\_cart, view\_cart — 0.5 d
- [ ] **M3.11** Tests: concurrency (two tabs editing), merge rules, limits; E2E add → cart → update qty — 1.5 d

## 6. Milestone 4 — Checkout, payments, orders (weeks 12–16)

Done when: a user can check out with UPI, card, net banking or COD in Razorpay test mode; orders are confirmed only by verified webhook; failures, retries, pending payments and refunds all work; no double charges or oversold stock in load tests.

**4A. Inventory reservation**

- [ ] **M4.1** `inventory_reservations` (order\_id, sku, offer, qty, expires\_at); reserve with `SELECT … FOR UPDATE` or atomic `UPDATE offers SET reserved = reserved + n WHERE stock - reserved >= n` — 2 d
- [ ] **M4.2** Expiry worker: release reservations after 15 min unpaid — 0.5 d

**4B. Checkout backend**

- [ ] **M4.3** `checkout_sessions` (cart snapshot or Buy Now item, address, delivery options, coupon, totals, expires 30 min) — 1 d
- [ ] **M4.4** `POST /checkout` (from cart or buy-now), `PATCH /checkout/:id` (address, delivery option, payment method, coupon) — 2 d
- [ ] **M4.5** Shipment splitting: group lines by seller/warehouse; delivery options and charges per shipment — 1.5 d
- [ ] **M4.6** Coupon engine v1: flat/percent, min order, max discount, per-user limit, validity window, category/seller scope — 2 d
- [ ] **M4.7** Gift card / store balance ledger, closed-loop only (usable only on ShopSphere, no cash-out or transfer, to stay outside RBI PPI licensing) (double-entry: `ledger_accounts`, `ledger_entries`) — 2 d
- [ ] **M4.8** Tax calculation: GST per line (CGST+SGST intra-state, IGST inter-state) based on seller state vs delivery state — 1 d
- [ ] **M4.9** `POST /checkout/:id/place-order` with idempotency key: revalidate prices/stock/coupon → create `orders`, `order_items`, `shipments` in `PENDING_PAYMENT` → reserve stock → return payment instruction (or confirm if COD) — 2 d

**4C. Payments**

- [ ] **M4.10** `PaymentProvider` interface (createOrder, verifySignature, capture, refund, fetchStatus) + Razorpay adapter — 2 d
- [ ] **M4.11** Tables: `payments` (order\_id, provider, provider\_order\_id, amount, status), `payment_attempts`, `webhook_events` (unique event\_id) — 0.5 d
- [ ] **M4.12** `POST /payments/:orderId/initiate` → gateway order; frontend opens Razorpay Checkout (UPI QR/intent, cards with 3DS, net banking, wallets, EMI) — 2 d
- [ ] **M4.13** Return handler `/checkout/result`: verify HMAC signature, show "Confirming…", poll `GET /orders/:id/status` — 1 d
- [ ] **M4.14** Webhook endpoint (Razorpay auto-capture enabled in dashboard, or explicit capture call here — uncaptured payments auto-refund): verify signature, store event idempotently, check amount/currency/order match, transition state in one DB transaction, publish `payment.captured` / `payment.failed` via outbox — 2 d
- [ ] **M4.15** On capture, or on COD confirmation at place-order: order `CONFIRMED`, reservation → stock deduction, cart cleared, coupon usage recorded, invoice job queued — 1 d
- [ ] **M4.16** Failure + retry with another method on the same order within 15 min. First capture wins: any second successful capture on the same order is auto-refunded and logged — 1 d
- [ ] **M4.17** Reconciliation worker: every 5 min for 24 h fetch status of pending payments; auto-refund money captured on cancelled/expired orders — 1.5 d
- [ ] **M4.18** Refund API + `refunds` table; partial refunds per item — 1.5 d
- [ ] **M4.19** COD rules: max ₹50,000, pincode eligibility, fraud-score gate — 0.5 d
- [ ] **M4.20** Saved cards via gateway tokenisation (RBI-compliant), saved UPI IDs — 1 d

**4D. Checkout UI**

- [ ] **M4.21** Minimal checkout header + single-page 3-step layout (address → payment → review) with prefilled defaults — 2 d
- [ ] **M4.22** Address step: select/add address, serviceability errors, remove undeliverable items — 1.5 d
- [ ] **M4.23** Delivery options per shipment + payment method selection + coupon/gift card inputs — 2 d
- [ ] **M4.24** Review step: items, dates, price breakdown, Place Order / Pay ₹X; price-change confirm modal — 1.5 d
- [ ] **M4.25** Order confirmation page + "Payment pending" and "Payment failed — retry" pages — 1.5 d
- [ ] **M4.26** Buy Now flow from PDP — 1 d

**4E. Orders (customer side)**

- [ ] **M4.27** Order state machine with allowed transitions enforced in code + `order_events` history table — 1.5 d
- [ ] **M4.28** "Your Orders" list (filters by year/status) + order detail with tracking timeline — 2.5 d
- [ ] **M4.29** Cancel order (before SHIPPED) → release stock → refund — 1 d
- [ ] **M4.30** GST invoice PDF per shipment, issued in the seller's name and GSTIN (marketplace model) (worker + S3 + download link) — 1.5 d
- [ ] **M4.31** Notifications v1: order placed, payment failed, shipped, delivered via email + SMS (templates, notification preferences) — 2 d

**4F. Tests**

- [ ] **M4.32** Integration tests with gateway sandbox; webhook replay/duplicate/out-of-order tests; signature tamper test — 2 d
- [ ] **M4.33** Load test (k6): 500 concurrent checkouts on 10 units of stock → exactly 10 orders, 0 negative stock — 1 d

**Added after architecture review**

- [ ] **M4.34** Late-capture handling: a payment captured after its reservation expired re-reserves stock if available and confirms the order; if stock is gone, auto-refund + apology email/SMS + order `CANCELLED_NO_STOCK` — 1.5 d
- [ ] **M4.35** Extend reservation to 30 min while a payment is in `PENDING` state (UPI collect/net banking in progress) — 0.5 d
- [ ] **M4.36** Staging-only test-payment toggle (forces success / failure / pending / late capture) for QA — 0.5 d
- [ ] **M4.37** Tests: late capture with and without stock, double capture → refund, COD deducts stock, uncaptured payment captured — 1.5 d

## 7. Milestones 5–7 — Sellers, admin, post-order, launch (weeks 15–24)

### Milestone 5 — Seller Central + shipping (weeks 15–18, parallel with M4 frontend)

Done when: a real seller can onboard, list products, receive an order, print a label, ship it and see their payout.

- [ ] **M5.1** Seller sign-up + KYC: PAN, GSTIN, bank account verification (penny drop via gateway API), pickup address; approval queue — 3 d
- [ ] **M5.2** Single product listing form: category → attribute form generated from `attribute_definitions`, variants matrix, image upload, offer price/stock — 3 d
- [ ] **M5.3** Bulk listing via CSV/XLSX template with row-level validation report — 2 d
- [ ] **M5.4** Inventory & price management table with inline edit — 1.5 d
- [ ] **M5.5** Seller order queue: accept → pack → generate label; shipment status updates — 2 d
- [ ] **M5.6** 3PL courier integration (Shiprocket/Delhivery adapter): rate, create shipment, AWB, label PDF, tracking webhooks → order states SHIPPED / OUT\_FOR\_DELIVERY / DELIVERED — 3 d
- [ ] **M5.7** Settlement engine: per-order commission, shipping fee, TCS/TDS; payout batches T+7 after delivery via payout API; statements — 3 d
- [ ] **M5.8** Seller dashboard: sales, orders, returns, payout summary — 1.5 d

* [ ] **M5.6a** Switch the delivery-estimate service (M2.7) from the stub zone table to courier serviceability + SLA data, refreshed nightly — 1.5 d

### Milestone 6 — Post-order, reviews, admin (weeks 19–21)

- [ ] **M6.1** Returns/replacement: eligibility window per category, reason picker, pickup scheduling via 3PL, QC status, refund on receipt — 3 d
- [ ] **M6.2** Reviews: only verified buyers after DELIVERED, star + text + photos, moderation queue, helpful votes, rating histogram, aggregate update job — 3 d
- [ ] **M6.3** Customer Q&A on PDP with seller answers — 1.5 d
- [ ] **M6.4** Review summary via LLM (batch job, cached per product) — 1 d
- [ ] **M6.5** Admin console: RBAC (super-admin, catalog, support, finance), user/seller management, catalog moderation, order lookup + manual refund, audit log viewer — 4 d
- [ ] **M6.6** Promotions builder: coupons, lightning deals (time window, quantity cap, % claimed), bank offers — 2.5 d
- [ ] **M6.7** Home-page CMS editor (drag-order sections, schedule banners, preview) — 2 d
- [ ] **M6.8** Help centre + contact/support ticket form linked to orders — 1.5 d
- [ ] **M6.9** WhatsApp + web push notifications — 1.5 d

### Milestone 7 — Hardening and launch (weeks 22–24)

- [ ] **M7.1** Security: OWASP ASVS checklist, dependency scanning, CSP/HSTS, WAF rules, bot protection on login/checkout, external pen-test and fixes — 4 d
- [ ] **M7.2** Fraud scoring v1 (rules: velocity, device fingerprint, high-value first order, address mismatch) → force prepaid / manual review — 2 d
- [ ] **M7.3** Compliance: privacy policy, cookie consent, DPDP data export + account deletion, GST e-invoicing, grievance officer page — 2 d
- [ ] **M7.4** Accessibility audit (axe + manual screen reader) to WCAG 2.1 AA — 2 d
- [ ] **M7.5** Load test full journey at 10× expected peak; tune DB indexes, connection pools, caching; sale-day waiting room — 3 d
- [ ] **M7.6** Backups + restore drill (RPO 5 min, RTO 30 min); multi-AZ failover test — 1 d
- [ ] **M7.7** Runbooks + alerts: payment success rate < 90%, webhook lag > 2 min, error rate, checkout latency — 1.5 d
- [ ] **M7.8** Switch gateway to live keys, payment go-live checks with real ₹1 transactions per method — 1 d
- [ ] **M7.9** Beta launch to 1,000 invited users behind flag → fix → public launch — 1 week

* [ ] **M7.10** Legal review: closed-loop wallet stays outside RBI PPI licensing; marketplace model complies with FDI rules (platform does not own inventory); TCS/TDS handling — external counsel, 1 week elapsed

## 8. Data model, APIs, testing and timeline

**Core tables (PostgreSQL)**

| Module | Tables |
| --- | --- |
| Identity | users, user\_identities, sessions, refresh\_tokens, otp\_challenges, addresses |
| Catalog | categories, brands, products, skus, product\_images, attribute\_definitions |
| Seller | sellers, seller\_kyc, offers, settlements, payouts |
| Inventory | offers.stock\_qty / reserved\_qty, inventory\_reservations |
| Cart | carts, cart\_items, saved\_items, wishlists, wishlist\_items |
| Checkout | checkout\_sessions, coupons, coupon\_redemptions |
| Order | orders, order\_items, shipments, order\_events, returns, invoices |
| Payment | payments, payment\_attempts, refunds, webhook\_events, ledger\_accounts, ledger\_entries |
| Content | home\_sections, banners, reviews, review\_votes, questions, answers |
| Platform | outbox\_events, audit\_logs, notifications |

Key rules: money as `BIGINT` paise; `orders.idempotency_key UNIQUE`; `webhook_events.event_id UNIQUE`; check constraint `stock_qty >= reserved_qty >= 0`.

**Main API endpoints**

```
AUTH     POST /auth/otp/request | /auth/otp/verify | /auth/login | /auth/refresh | /auth/logout
USER     GET/PATCH /me      CRUD /me/addresses
CATALOG  GET /home | /categories | /products/:slug | /products/:id/offers | /delivery-estimate?sku&pincode
SEARCH   GET /search | /search/suggest
CART     GET /cart  POST /cart/items  PATCH|DELETE /cart/items/:id  POST /cart/items/:id/save-for-later
CHECKOUT POST /checkout  PATCH /checkout/:id  POST /checkout/:id/place-order
PAYMENT  POST /payments/:orderId/initiate  POST /webhooks/razorpay
ORDERS   GET /orders | /orders/:id | /orders/:id/status  POST /orders/:id/cancel | /orders/:id/returns
REVIEWS  GET/POST /products/:id/reviews
SELLER   /seller/* (onboarding, listings, inventory, orders, payouts)
ADMIN    /admin/* (RBAC protected)
```

**Testing strategy**

- Unit tests for pricing, tax, coupon, buy-box, state machine (≥ 80% coverage on these modules).
- Integration tests with Testcontainers (real Postgres/Redis/OpenSearch).
- Contract tests from the OpenAPI spec for web ↔ API.
- E2E (Playwright) on staging for 5 golden paths: sign up, search → PDP, add to cart, checkout with UPI test, cancel + refund.
- k6 load tests per milestone; Lighthouse CI budget on every PR.

**Timeline (24 weeks + 4 weeks buffer = 28 weeks, 10-person team)**

| Weeks | Milestone | Demo at end |
| --- | --- | --- |
| 1–2 | M0 Foundations | Auto-deploy to staging |
| 3–4 | M1 Identity | Sign up / login |
| 5–9 | M2 Catalog, search, home, PDP | Browse and search full catalog |
| 10–11 | M3 Cart | Add to cart, guest merge |
| 12–16 | M4 Checkout, payments, orders | First paid test order |
| 15–18 | M5 Seller Central + shipping | Seller ships an order |
| 19–21 | M6 Post-order, reviews, admin | Return + review + admin refund |
| 22–24 | M7 Hardening + launch | Public launch |

Buffer: add \~4 weeks (≈15%) after week 24, used mainly for M4 payments and M7 hardening overruns. Public launch target = week 28.

**Critical path:** M0 → M1 → M2 catalog → M3 cart → M4 checkout/payments. Start the payment gateway merchant account and courier contracts in week 1 — KYC approvals can take 2–4 weeks.

**Top risks**

- Overselling during flash sales → atomic reservations + load test M4.33.
- Payment marked paid but webhook lost → reconciliation worker M4.17.
- Search relevance poor at launch → tune with search analytics from beta.
- Scope creep → anything not in this plan goes to the v2 backlog.

* Late UPI success after stock released → M4.34 / M4.35.
* Double payment on retry → first-capture-wins rule in M4.16.
* Stale prices on cached pages → live client fetch in M2.22.
* Legal/regulatory surprises (wallet, FDI, invoicing) → M7.10, started early.
