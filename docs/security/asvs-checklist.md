# OWASP ASVS 4.0.3 Level 2 — internal review (M7.1)

**Scope:** `apps/api`, `apps/web`, `apps/seller`, `apps/admin`, `apps/bank-sim`, `apps/courier-sim`
(plus `apps/workers` where it touches the API). **Date:** 2026-11-01. **Method:** code review of
every controller/guard/config, targeted integration tests (`apps/api/test/security.int.spec.ts`),
`pnpm audit`, and the Playwright suites on the real stack. The external pen-test in the plan is out
of scope for this simulation; this document is the internal review that replaces it.

Status: **Pass** = meets L2 · **Fixed** = failed, fixed in M7.1 · **Partial** = mitigated, gap
recorded · **N/A** = not applicable to a simulation (no real money, real PII or real carriers) ·
**Accepted** = known risk with rationale.

## Summary of fixes made in M7.1

| # | Finding | Fix |
| --- | --- | --- |
| F1 | No security headers on any app (no HSTS, CSP, nosniff, frame protection); `X-Powered-By: Express` leaked | API middleware `shared/security/security-headers.ts`; nonce CSP + headers in `web`/`seller`/`admin` `middleware.ts` (shared builder `@shopsphere/config/csp`); bank-sim / courier-sim header middleware |
| F2 | Express `trust proxy` unset: behind a load balancer every client shares the LB IP, so per-IP rate limits and fraud IP velocity are useless (or trivially global) | `TRUST_PROXY_HOPS` env (hop count, never `true`) in `main.ts` |
| F3 | Place-order had no bot protection beyond the global 120 req/min | `@RateLimit` on `POST /checkout/:id/place-order` (`PLACE_ORDER_RATE_LIMIT_PER_MINUTE`, default 20/IP/min) + risk-driven Turnstile step-up (`428 CAPTCHA_REQUIRED`) |
| F4 | Critical/high advisories in prod deps: Next.js 15.1.6 (middleware auth bypass GHSA-f82v-jwr5-mffw, RSC RCE, image-optimizer RCE, SSRF, DoS), multer, body-parser, path-to-regexp, express, fast-xml-parser, nodemailer, postcss, sharp | Next 15.5.28; nodemailer 10.3.1; sharp 0.35.5; postcss 8.5.32; pnpm `overrides` for transitive express/body-parser/path-to-regexp/multer/fast-xml-parser/postcss. `pnpm audit --prod --audit-level high` now clean (2 accepted, below) |
| F5 | No dependency or secret scanning in CI | `.github/workflows/security.yml` (pnpm audit, dependency-review, gitleaks), `.github/dependabot.yml`, `.gitleaks.toml` |
| F6 | `SESSION_COOKIE_SECRET` dev default was accepted in production (JWT secret was already guarded) | Production refine in `identity.config.ts` |
| F7 | COD risk was a 4-rule stub with no device/IP signal, no record and no human review | Fraud scoring v1 (`modules/fraud`, see section "V11 / fraud") |

Accepted advisories (`package.json` → `pnpm.auditConfig.ignoreGhsas`):

- **GHSA-7mvr-c777-76hp** (playwright < 1.55.1, browser download integrity): dev/CI tooling only, never
  shipped; pulled into the prod graph only as Next's optional peer. Upgrade with the next E2E browser refresh.
- **GHSA-mrhx-c7xc-m3w5** (zod 3 memory exhaustion on oversized constrained collections): fix is zod 4
  (major). All request schemas bound array/string sizes (`.max()`), and JSON bodies are capped by
  body-parser limits (1 MB default; 8–12 MB only on the two upload routes), which bounds the input the
  issue needs. Track zod 4 migration as planned work.

## V1 Architecture, design and threat modelling

| Req | Status | Notes |
| --- | --- | --- |
| 1.1 Secure SDLC, threat model | Partial | PRD §9/§10 + this review; no formal STRIDE doc. Payment threat model lives in the payments design (webhook-only paid state, first-capture-wins, reconciliation). |
| 1.2 Authentication architecture | Pass | Single identity module; all apps use the same short-lived JWT access token + rotating refresh cookie. Staff/seller roles are rows checked server-side per request. |
| 1.4 Access control architecture | Pass | Deny by default: every controller has `AccessTokenGuard`, `SellerGuard`, `StaffGuard` + `@Roles`, or a timing-safe internal-token guard. Ownership enforced in services (`where: { userId }`). |
| 1.5 Input/output architecture | Pass | zod schemas at every controller boundary; JSON-only API; React escapes output; JSON-LD uses `<` escaping. |
| 1.6 Cryptographic architecture | Pass | HMAC-SHA256 for webhooks/payment signatures, argon2id for passwords, random 128-bit ids. Secrets via env (vault in prod per PRD). |
| 1.14 Configuration architecture | Fixed | Env validated with zod at boot; production refuses dev secrets (F6). Headers centralised (F1). |

## V2 Authentication

| Req | Status | Notes |
| --- | --- | --- |
| 2.1 Password security | Pass | argon2id (`@node-rs/argon2`), min length enforced, breached/common check via length + rules; no composition rules; paste allowed. |
| 2.2 General authenticator / anti-automation | Pass | Login, OTP request/verify, password reset rate-limited per IP (`@RateLimit`), progressive Turnstile after failed logins (`login-throttle.service.ts`), account lock-out window. |
| 2.3 Authenticator lifecycle | Pass | OTP codes single-use, 5-min TTL, hashed at rest, attempt-capped. |
| 2.5 Credential recovery | Pass | Reset via OTP to verified contact; no hints; sessions revoked on password change. |
| 2.7 Out-of-band verifiers | Pass | Email/SMS OTP (simulated via Mailpit). |
| 2.8 One-time verifiers (TOTP) | N/A | Staff 2FA is planned for go-live (M7.8 checklist); simulation staff use OTP sign-in. |
| 2.10 Service authentication | Pass | Worker → API routes use `x-internal-token` (timing-safe compare, ≥16 chars, required in production). Tested: all internal routes 401 without it. |

## V3 Session management

| Req | Status | Notes |
| --- | --- | --- |
| 3.2 Session binding | Pass | Opaque refresh token (rotated, reuse-detected) in `HttpOnly; Secure; SameSite` cookie scoped to `/auth`; access JWT 15 min. |
| 3.3 Logout / timeout | Pass | Logout revokes the session row; "sign out everywhere" revokes all. |
| 3.4 Cookie attributes | Pass | `HttpOnly`, `Secure` (prod), `SameSite=Lax`, signed session cookie. |
| 3.5 Token-based sessions | Partial | Admin and Seller Central keep the **access** token in `localStorage` (refresh stays HttpOnly). XSS would expose a ≤15-min token. Mitigated by nonce CSP with `strict-dynamic` on both apps (F1). Move to memory-only tokens later. |
| 3.7 Re-authentication for sensitive actions | Partial | Password/contact changes require OTP; staff money actions (refund) rely on role + audit only. |

## V4 Access control

| Req | Status | Notes |
| --- | --- | --- |
| 4.1 General | Pass | Server-side only; UI hides nav by role but the API enforces (`StaffGuard` + `@Roles`). |
| 4.2 Operation level / IDOR | Pass (tested) | `security.int.spec.ts`: another customer gets **404** on checkout GET/PATCH/place-order, order detail/status/invoice/return, cancel; another seller gets 404 on shipment view/accept; customer token is refused on seller routes. Existing suites cover returns, reviews, payouts. 404 (not 403) avoids id enumeration. |
| 4.3 Admin interfaces | Pass (tested) | Staff-only, role-checked (401 anonymous, 403 customer, 403 wrong role); every mutation audited by `AdminAuditInterceptor`; disabled staff blocked. |

## V5 Validation, sanitisation, encoding

| Req | Status | Notes |
| --- | --- | --- |
| 5.1 Input validation | Pass | zod on every body/query; UUID params checked; `.strict()` on update DTOs. |
| 5.2 Sanitisation | Pass | Review text stored as text, rendered by React; uploads re-encoded by sharp (EXIF stripped). |
| 5.3 Output encoding / injection | Pass | Prisma parameterised queries; the few `$queryRaw` use tagged templates (parameterised). No `eval`/shell. bank-sim views escape every interpolation (`esc()`). |
| 5.5 Deserialisation | Pass | JSON only; body size limits; webhook raw body verified before parse. |

## V6 Stored cryptography

| Req | Status | Notes |
| --- | --- | --- |
| 6.2 Algorithms | Pass | argon2id, HMAC-SHA256, Node `crypto` random. No custom crypto. |
| 6.4 Secret management | Partial | Env vars locally; PRD mandates a vault in production. gitleaks now scans history (F5). |

## V7 Errors and logging

| Req | Status | Notes |
| --- | --- | --- |
| 7.1 Log content | Pass | Request id on every log line; tokens/passwords never logged; PAN/card data never reaches us (gateway iframe / bank-sim). |
| 7.2 Log processing | Pass | Append-only `audit_logs` for admin + money actions; fraud review decisions write `fraud.review.*` entries. |
| 7.4 Error handling | Pass | `GlobalExceptionFilter` returns `{code,message}`; 5xx bodies are generic, stack traces stay server-side. |

## V8 Data protection

| Req | Status | Notes |
| --- | --- | --- |
| 8.1 General | Pass | `Cache-Control: no-store` on checkout/order/invoice responses; invoices in a private bucket. |
| 8.2 Client-side | Partial | See 3.5 (localStorage access token on staff/seller apps). Customer web uses cookies only. |
| 8.3 Sensitive private data | Pass | DPDP export/deletion is M7.3 (compliance worker). Fraud rows keep IP + device id only. |

## V9 Communications

| Req | Status | Notes |
| --- | --- | --- |
| 9.1 TLS | Pass (prod design) | TLS terminates at the CDN/LB; HSTS `max-age=2y; includeSubDomains; preload` on every app; `upgrade-insecure-requests` when the app is served over https. Local stack is plain http by design. |
| 9.2 Server comms | Pass | Gateway/courier calls over https in prod; webhooks authenticated by HMAC (not by network). |

## V10 Malicious code

| Req | Status | Notes |
| --- | --- | --- |
| 10.3 Integrity / dependencies | Fixed | F4 + F5: audit gate, dependency-review on PRs, Dependabot weekly, lockfile `--frozen-lockfile --ignore-scripts` in the audit job. |

## V11 Business logic (incl. fraud — M7.2)

| Req | Status | Notes |
| --- | --- | --- |
| 11.1 Business logic | Pass | Totals recomputed server-side; `expectedTotalPaise` must match (409 on change); idempotency keys on place-order/payment initiate; atomic stock reservations; first-capture-wins on payments. |
| 11.1.4 Anti-automation | Fixed | F3 + fraud velocity rules. |
| 11.1.7/8 Abuse monitoring & alerts | Fixed | Fraud scoring v1: every order scored (`fraud_assessments`), high-risk COD refused (`422 COD_UNAVAILABLE`, the quote also hides COD), very high risk held (`orders.fraud_hold`, sellers get `409 ORDER_ON_HOLD`), admin queue `/fraud` (SUPPORT) approve releases / reject cancels + refunds, both audited. |

**Fraud rules v1** (`apps/api/src/modules/fraud/fraud-rules.ts`, all thresholds env-configurable):

| Signal | Points | Default trigger |
| --- | --- | --- |
| USER_VELOCITY / USER_VELOCITY_BURST | 25 / 45 | ≥ 3 / ≥ 6 orders by the account in 1 h |
| DEVICE_VELOCITY | 25 | ≥ 5 orders from the device (`ss_did` cookie) in 1 h |
| DEVICE_SHARED | 30 | ≥ 3 accounts ordering from one device in 24 h |
| DEVICE_MISSING | 10 | No device fingerprint cookie on place-order |
| IP_VELOCITY | 20 | ≥ 15 orders from one client IP in 1 h (loopback not scored) |
| HIGH_VALUE_FIRST_ORDER | 35 | First order ≥ ₹10,000 |
| VERY_HIGH_VALUE | 10 | Order ≥ 2.5 × high-value threshold |
| ADDRESS_MISMATCH | 15 | Billing (default address) state ≠ shipping state |
| COD_NEW_ACCOUNT | 20 | COD on an account younger than 7 days |

Decisions: COD and score ≥ 50 → force prepaid · prepaid and score ≥ 80 → `MANUAL_REVIEW` hold ·
score ≥ 60 with a velocity signal → Turnstile step-up. Known limits: device id is a first-party
cookie (clearing cookies resets it → scored as DEVICE_MISSING); no BIN/card or address-geocode
signals yet; per-IP place-order limit may need raising for CGNAT-heavy mobile networks on sale days.

## V12 Files and resources

| Req | Status | Notes |
| --- | --- | --- |
| 12.1 Upload | Pass | Only base64 images (reviews) and CSV/XLSX (seller bulk) with size caps on those routes; type sniffed; images re-encoded. |
| 12.4 Storage | Pass | Private S3 bucket; downloads only via 5-minute pre-signed URLs issued after an ownership check (tested in `checkout.int.spec.ts` + checkout-api E2E: unsigned GET → 403). |
| 12.6 SSRF | Pass | No user-supplied URLs are fetched server-side; bank-sim `callback_url` limited to `ALLOWED_CALLBACK_ORIGINS`. Next 15.5.28 fixes the framework SSRF advisories. |

## V13 API and web services

| Req | Status | Notes |
| --- | --- | --- |
| 13.1 Generic | Pass | CORS allow-list (`CORS_ORIGINS`), credentials only for those origins; JSON content type; 1 MB default body cap. |
| 13.2 RESTful | Pass | CSRF: cookie-authenticated mutations (`/auth/refresh`, logout) need the double-submit `x-csrf-token`; everything else uses a Bearer header (not ambient). |
| Webhooks | Pass (tested) | Razorpay + bank: HMAC over the raw body, timing-safe compare, event id de-duplicated (`webhook_events` unique); courier-sim: HMAC header. Bad/missing signature → 4xx with no side effects. |

## V14 Configuration

| Req | Status | Notes |
| --- | --- | --- |
| 14.2 Dependencies | Fixed | F4/F5. |
| 14.3 Unintended disclosure | Fixed | `X-Powered-By` removed; generic 5xx bodies; no source maps served in prod builds. |
| 14.4 HTTP security headers | Fixed (tested) | **API:** `CSP default-src 'none'; frame-ancestors 'none'`, HSTS, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP, CORP same-site, Permissions-Policy. **Seller/Admin:** per-request nonce + `'strict-dynamic'` CSP on every page (root layout dynamic). **Web:** nonce CSP on per-request routes (`/checkout`, `/account`, `/signin`, `/orders`, `/cart`); ISR/static catalogue pages cannot carry a per-request nonce, so they get the same policy with `'unsafe-inline'` scripts (no eval, `object-src 'none'`, `frame-ancestors 'none'`, locked `connect-src`/`frame-src`/`form-action`) — **Partial** for those pages, chosen to keep ISR (PRD LCP target). **bank-sim:** no scripts at all, inline styles only. **courier-sim:** `default-src 'none'`. |
| 14.5 Request header validation | Pass | `x-request-id` validated; Host-header not used for URL building (configured `WEB_URL`/`API_URL`). |

## Not covered here (other M7 items)

- WAF rules: edge/CDN configuration (Cloudflare managed rules + rate rules) is infra, recorded for go-live.
- Staff TOTP / WebAuthn, vault integration, quarterly external pen-test: go-live checklist.
- DPDP, cookie consent, accessibility: M7.3/M7.4 (other workers).
