# PRD — ShopSphere E-commerce Website

Oct 27, 2026 · @Shivansh Mishra

## 1. Overview

ShopSphere is a multi-vendor e-commerce website (web only, responsive desktop + mobile web) where customers discover, compare and buy products from many sellers, with one cart, one checkout and fast delivery. Launch market: India (INR, UPI, GST); architecture stays multi-currency ready.

**Goals (first 12 months)**

- Checkout conversion (cart → order) ≥ 35%; site-wide conversion ≥ 3%.
- Largest Contentful Paint < 2.5 s on 4G for home, search and product pages.
- Payment success rate ≥ 95%; zero card data stored on our servers (PCI DSS SAQ-A scope).
- 99.9% monthly uptime for browse, cart and checkout.

**Personas**

| Persona | Need | Key features |
| --- | --- | --- |
| Shopper (guest or signed in) | Find a product fast, trust the price and delivery date | Search, filters, reviews, delivery estimate, easy returns |
| Repeat buyer | Reorder with minimum clicks | Saved addresses, saved UPI/cards via gateway tokens, Buy Now, order history |
| Seller | List products, manage stock and orders | Seller Central portal |
| Admin / Ops | Moderate catalog, handle refunds, run promotions | Admin console |

**In scope:** customer website, seller portal (web), admin console, payments, orders, returns, notifications. **Out of scope (v1):** native iOS/Android apps, video streaming, voice ordering, own logistics fleet (we integrate 3PL couriers), cross-border shipping.

## 2. Product description and feature list

ShopSphere lets anyone land on the site, search or browse millions of products across categories (electronics, fashion, home, grocery, books), see a clear price, seller, rating and delivery date, add items to a single cart, and pay in under a minute with UPI, cards, net banking, wallets, EMI or Cash on Delivery. After purchase, customers track, cancel, return and review orders. Sellers list and fulfil products; ShopSphere earns a commission per sale plus a paid membership (ShopSphere Plus: free fast delivery, early deal access).

| Module | Must-have features (v1) | Later (v2+) |
| --- | --- | --- |
| Identity & accounts | Sign up / login (email, mobile OTP, Google), profile, addresses, sessions, 2FA | Passkeys, family accounts |
| Catalog | Categories, products with variants (size/colour), images, specs, multi-seller offers | 3D/AR views, video |
| Search & discovery | Autocomplete, typo-tolerant search, filters, sort, recommendations | Visual search, conversational AI shopping assistant |
| Product page | Gallery, price & discounts, buy box, delivery estimate by pincode, reviews, Q&A | Size advisor |
| Cart & wishlist | Cart (guest + logged in, merged on login), Save for later, wishlists | Shared lists, subscribe & save |
| Checkout | Address, delivery option, payment, coupon, gift card, order review, Buy Now | One-click reorder |
| Payments | Gateway integration (Razorpay/Stripe/PayU), UPI, cards, net banking, wallets, EMI, COD, refunds | BNPL, international cards |
| Orders & returns | Order history, tracking, cancel, return/replace, invoices (GST) | Instant refunds to wallet |
| Deals & pricing | Coupons, lightning deals, bank offers, membership pricing | Dynamic pricing |
| Notifications | Email, SMS, WhatsApp, web push for order events | Price-drop alerts |
| Seller Central | Onboarding + KYC, listings, inventory, orders, payouts, reports | Ads, analytics |
| Admin console | Catalog moderation, users, refunds, promotions, CMS for home page | Fraud ML console |
| Customer support | Help centre, chat, order-issue flows | AI support agent |

## 3. Entering the site: sign up and login

Browsing, search and cart work without an account; login is required only at checkout, so we never block discovery.

**Sign up**

1. User clicks "Hello, Sign in" in the header or reaches checkout.
2. Enters mobile number or email. If new, we ask for name and password (min 8 chars, strength meter) — or skip password and use OTP-only.
3. OTP (6 digits, 5-minute expiry, max 5 attempts, resend after 30 s) verifies the phone/email.
4. Account created; guest cart merges into the user cart; user returns to where they were.

**Login options**

- Mobile + OTP (default in India), email/mobile + password, "Continue with Google".
- Optional 2FA (TOTP app or SMS) under Login & Security.
- "Keep me signed in" = refresh token valid 30 days; otherwise session ends when browser closes.
- Forgot password: OTP to verified email/phone, then set new password; all other sessions logged out.

**Security rules**

- Passwords hashed with Argon2id; never logged.
- Short-lived JWT access token (15 min) in memory + rotating refresh token in HttpOnly, Secure, SameSite=Lax cookie.
- Rate limit: 5 failed logins per 15 min per account and per IP, then CAPTCHA; lockout alerts by email.
- Re-authentication required to change password, phone, email or saved payment methods.
- New-device login → email/SMS alert.

**Account area ("Your Account")**: Orders, Login & Security, Addresses, Payment options, Wishlists, ShopSphere Plus, Gift card balance, Notification preferences, Delete account (DPDP Act compliant).

## 4. Home page design

The home page gets a shopper from landing to a relevant product in one click: search first, then personalised rows. All rows are configured by admins in a CMS and ranked per user.

**Layout, top to bottom**

| Zone | Content | Behaviour |
| --- | --- | --- |
| Header (sticky) | Logo · "Deliver to \<pincode>" · category dropdown + search bar · language · Account & Lists · Returns & Orders · Cart with item count | Search is the widest element; pincode drives prices and delivery dates site-wide |
| Category nav strip | All (hamburger mega-menu), Today's Deals, Mobiles, Fashion, Electronics, Home, Grocery, Plus | Horizontal scroll on mobile |
| Hero carousel | 3–6 banners (sales, launches, bank offers) | Auto-rotate 5 s, pause on hover, swipe on mobile, every banner links to a filtered listing |
| Quad cards | 4 cards of 4 tiles each: "Continue shopping", "Keep shopping for", category picks, "Sign in for best experience" (guests) | Personalised |
| Deal rows | Today's Deals with countdown timers and % claimed bars | Real-time stock |
| Recommendation rows | "Inspired by your browsing", "Buy again", "Best sellers in X", "Top rated" | Horizontal carousels, lazy-loaded |
| Recently viewed | Last 20 viewed products | Stored per user / per browser for guests |
| Footer | Back to top · About, Careers · Sell on ShopSphere · Help, Returns · Policies · Country/language | Static |

**Design rules**

- Grid: 12 columns, max width 1500 px; breakpoints 360 / 768 / 1024 / 1440 px.
- Product tile: image (1:1, WebP/AVIF), title (2 lines max), rating stars + count, price + MRP struck-through + % off, "Plus" badge, delivery date.
- Above-the-fold content server-rendered; rows below lazy-load on scroll with skeleton placeholders.
- Accessibility: WCAG 2.1 AA, keyboard navigable carousels, alt text on all images, 4.5:1 contrast.
- Guests see trending/best-seller rows; signed-in users see history-based rows.

## 5. Search and listing pages

Search returns relevant results in under 300 ms (p95) and lets users narrow them with filters without a page reload.

- **Autocomplete:** suggestions after 2 characters (queries, categories, recent searches), debounced 150 ms.
- **Relevance:** typo tolerance, synonyms ("tv" = "television"), Hindi/Hinglish transliteration; ranking blends text match, sales, rating, conversion, stock and sponsored slots (labelled "Sponsored").
- **Filters (left rail desktop, bottom sheet mobile):** category, brand, price range slider, customer rating, discount %, delivery speed (Plus / tomorrow), seller, availability, category-specific attributes (RAM, size, colour).
- **Sort:** Featured, Price low→high, high→low, Avg. rating, Newest.
- **Results grid:** 48 per page with pagination (SEO-friendly URLs, e.g. `/s?k=headphones&brand=sony&page=2`); each tile has quick "Add to cart".
- **No results:** spelling suggestion, related categories, and "did you mean".
- **Category pages:** same engine with curated banners and sub-category tiles.

## 6. Product page design

The product detail page (PDP) answers four questions above the fold — what is it, how much, is it good, when will it arrive — and puts "Add to Cart" and "Buy Now" within one click.

**Desktop layout: three columns**

| Column | Contents |
| --- | --- |
| Left (≈40%) — Gallery | Up to 9 images + video; thumbnails on the side; hover-zoom (desktop), pinch-zoom and swipe (mobile); full-screen viewer |
| Middle (≈35%) — Details | Brand link · title · ★ rating + review count + "1K+ bought in past month" · price, MRP struck, % off, "Inclusive of all taxes" · EMI from ₹X/month · bank offers (expandable) · variant selectors (colour swatches, size chips with out-of-stock greyed) · "About this item" 5–7 bullets · key specs |
| Right (≈25%) — Buy box (sticky) | Price · delivery date for selected pincode ("FREE delivery Thursday, 29 Oct. Order within 3 hrs 12 mins") · stock status ("Only 3 left") · quantity dropdown (max per-product limit) · **Add to Cart** (primary) · **Buy Now** · "Sold by X, Fulfilled by ShopSphere" · return policy (e.g. 10-day replacement) · secure-transaction badge · Add to Wishlist · "Other sellers from ₹Y" |

**Below the fold**

1. Frequently bought together (bundle with combined price + one-click add all).
2. Product description (seller rich content: images + text) and full specification table.
3. Compare with similar items (table of 4–5 products).
4. Customer Q&A (search, ask, seller/customer answers).
5. Reviews: rating histogram, AI summary of review themes, filter by stars/verified purchase/with images, sort by top/recent, helpful votes, report abuse. Only verified buyers can review.
6. Customers who viewed this also viewed; sponsored products.

**Mobile web:** single column — gallery, title, price, variants, delivery, then a sticky bottom bar with Add to Cart / Buy Now.

**Rules:** variant change updates URL, price, images and stock without reload; price and stock fetched live (cache max 60 s); out-of-stock shows "Notify me"; structured data (schema.org Product, Offer, AggregateRating) for SEO.

## 7. Adding to cart and the cart page

Adding to cart is instant and never loses an item: guest carts live in a cookie-keyed server cart for 30 days and merge into the account cart on login.

**Add to cart flow**

1. User picks variant + quantity and clicks Add to Cart (PDP, listing tile or deal row).
2. Client calls `POST /cart/items {sku, sellerId, qty}`; button shows spinner, UI updates optimistically.
3. Server validates: SKU active, seller offer live, qty ≤ stock and ≤ per-customer limit, deliverable to current pincode.
4. Success → header cart count animates; side drawer shows "Added to cart", subtotal, "Proceed to checkout" and 3 add-on suggestions.
5. Failure → inline message ("Only 2 available", "Not deliverable to 560100").

Stock is **not** reserved at add-to-cart; it is soft-reserved at payment start (section 8).

**Cart page**

- Line items grouped by seller/delivery: image, title, variant, price, "In stock", delivery date, qty selector, Delete, Save for later, Share.
- Price-change and stock-change banners when something changed since adding ("Price dropped from ₹1,299 to ₹1,199").
- Right summary: Subtotal (N items) · eligible for FREE delivery progress bar ("Add ₹120 more") · gift option checkbox · **Proceed to Buy**.
- Save for later list below cart; recommendations at bottom.
- Limits: max 50 distinct items, max 10 per item (configurable per SKU).
- Cart totals are always recomputed on the server; the client never sends prices.

## 8. Checkout

Checkout is a single page with three collapsible steps (Address → Payment → Review), prefilled from defaults, so a returning user can place an order in one click on "Place Order". The header is stripped (logo + "Secure checkout" only) to cut distractions.

**Steps**

1. **Sign in** if guest (OTP fastest path).
2. **Delivery address:** pick saved address or add new (name, mobile, pincode → auto-fill city/state, house, area, landmark, address type Home/Work). Pincode serviceability checked; non-deliverable items flagged with option to remove.
3. **Delivery option per shipment:** Standard (free above ₹499), One-day, Scheduled slot (grocery/large items).
4. **Payment method:** choose method (section 9); apply coupon code, gift card or ShopSphere Pay balance.
5. **Review:** items, delivery dates, final price breakdown, then **Place Order** (or **Pay ₹X**).

**Price breakdown (computed server-side)**

| Line | Example |
| --- | --- |
| Items | ₹2,598 |
| Delivery | ₹0 |
| Coupon / bank offer | −₹200 |
| Gift card applied | −₹100 |
| COD fee (if COD) | ₹0–10 |
| **Order total (incl. GST)** | **₹2,298** |

**What happens when "Place Order" is clicked**

1. Server re-validates cart: prices, stock, coupon eligibility, serviceability. Any change → show diff and ask to confirm.
2. Creates an `order` in status `PENDING_PAYMENT` with an idempotency key (double-clicks create one order).
3. Soft-reserves stock for 15 minutes.
4. Hands off to payment (section 9). COD skips straight to `CONFIRMED`.
5. Reservation expires unpaid → stock released, order `PAYMENT_FAILED`, cart kept intact.

**Buy Now** skips the cart: creates a one-item checkout session with the same steps.

**Edge cases:** price change mid-checkout, item out of stock, coupon expired, session timeout (30 min), user opens checkout in two tabs (same idempotency key), split shipments from multiple sellers (one order, many shipments).

## 9. Payments: how a payment completes

We never touch raw card data: a PCI-DSS Level 1 gateway (e.g. Razorpay, Stripe or PayU) collects payment details in its hosted checkout/iframe, and an order is marked paid only after a signature-verified server webhook — never on a browser redirect alone.

**Supported methods**

| Method | How it works | Notes |
| --- | --- | --- |
| UPI | Collect request to VPA, QR code (desktop), or intent (mobile web) | Poll status every 3 s up to 5 min |
| Credit / debit card | Gateway iframe; 3-D Secure OTP mandatory | Saved via RBI-compliant network tokenisation, CVV every time |
| Net banking | Redirect to bank | 50+ banks |
| Wallets | Redirect / SDK | Paytm, PhonePe, etc. |
| EMI / Pay Later | Card EMI, no-cost EMI (we subsidise interest) | Min order ₹3,000 |
| Cash on Delivery | No online step | Limit ₹50,000; may be disabled by fraud score |
| Gift card / ShopSphere Pay balance | Internal ledger debit | Can combine with one other method |

**End-to-end payment flow**

1. Order created `PENDING_PAYMENT` (section 8).
2. Our Payment Service calls gateway `create order` with amount (in paise), currency, our order ID as receipt, idempotency key → gets `gateway_order_id`.
3. Browser opens gateway checkout with that ID; user completes UPI / OTP / bank login.
4. Gateway redirects back to `/checkout/result` with payment ID + signature. Browser shows "Confirming your payment…" and the server verifies the HMAC signature.
5. In parallel, gateway sends a webhook (`payment.captured` / `payment.failed`) to our server. We verify the webhook signature, check amount and order match, and process it idempotently (event ID stored).
6. On success: payment status `CAPTURED`, order `CONFIRMED`, stock reservation converted to a hard deduction, cart cleared, confirmation page + email/SMS/WhatsApp, invoice generated, seller notified.
7. On failure: order `PAYMENT_FAILED`, user sees reason and "Retry payment" with another method (same order, new attempt, within 15 min).
8. Pending (common with UPI/net banking): show "Payment pending", keep polling; reconciliation job queries gateway every 5 min for 24 h. Money captured after order cancelled → automatic refund.

**Refunds:** triggered by cancellation or approved return; refund to original method via gateway API (UPI/cards 5–7 working days) or instantly to ShopSphere Pay balance if user chooses. COD refunds go to bank account/UPI.

**Seller payouts:** money settles to ShopSphere's nodal/escrow account; sellers paid T+7 after delivery minus commission, shipping and TCS/TDS, via payout API.

**Fraud & compliance:** risk score on every order (velocity, device fingerprint, address mismatch, high-value first order); high risk → force prepaid or manual review. GST invoice per seller shipment. Daily three-way reconciliation: orders ↔ gateway settlements ↔ bank statement.

## 10. After the order, operations and implementation

**Order lifecycle:** `PENDING_PAYMENT → CONFIRMED → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED`, with branches `CANCELLED` (allowed until SHIPPED), `RETURN_REQUESTED → PICKED_UP → REFUNDED`, and `PAYMENT_FAILED`. Every transition emits an event that drives notifications and the tracking timeline on "Your Orders".

**Seller Central (web):** onboarding with PAN/GSTIN/bank KYC, single and bulk (CSV) listing, inventory and price updates, order queue with shipping-label printing via 3PL APIs, returns, payout statements.

**Admin console:** catalog moderation, user and seller management, refund/approval overrides, coupon and deal builder, home-page CMS, audit log of every admin action, role-based access.

**Technical architecture**

| Layer | Choice |
| --- | --- |
| Frontend | Next.js (React, TypeScript), SSR/ISR for SEO pages, Tailwind, served via CDN (CloudFront/Cloudflare) |
| API | API gateway + BFF; REST/JSON (GraphQL optional for PDP aggregation) |
| Services | Identity, Catalog, Search, Pricing & Offers, Inventory, Cart, Checkout, Order, Payment, Notification, Review, Seller, Admin |
| Data | PostgreSQL (orders, payments, users — ACID), MongoDB/DynamoDB (catalog), Redis (sessions, cart, cache), Elasticsearch/OpenSearch (search) |
| Messaging | Kafka for order/payment events; outbox pattern for reliable publishing |
| Media | S3 + image CDN with on-the-fly resize, WebP/AVIF |
| Infra | Kubernetes on AWS (ap-south-1), Terraform, CI/CD with canary releases |
| Observability | OpenTelemetry, Prometheus/Grafana, centralised logs, alerting on payment failure rate |

**Non-functional requirements**

- Performance: LCP < 2.5 s, INP < 200 ms, API p95 < 300 ms, checkout API p99 < 1 s.
- Scale: 50k concurrent users normal, 10× sale-day spikes (autoscaling, queue-based checkout waiting room).
- Availability 99.9%; RPO 5 min, RTO 30 min; multi-AZ databases.
- Security: OWASP Top 10, HTTPS/HSTS, CSP, WAF, bot protection, secrets in a vault, quarterly pen-tests.
- Compliance: PCI DSS (SAQ-A), RBI tokenisation, DPDP Act 2023, GST e-invoicing, Consumer Protection (E-Commerce) Rules.
- Accessibility WCAG 2.1 AA; English + Hindi at launch.

**Success metrics**

| Metric | Target |
| --- | --- |
| Search → PDP click-through | ≥ 40% |
| PDP → add to cart | ≥ 10% |
| Cart → order (checkout conversion) | ≥ 35% |
| Payment success rate | ≥ 95% |
| Return rate | ≤ 8% |
| Repeat purchase within 90 days | ≥ 30% |

**Roadmap**

1. **Phase 1 — MVP (months 0–4):** accounts, catalog, search, PDP, cart, checkout, UPI/cards/COD, orders, basic seller portal and admin.
2. **Phase 2 — Growth (months 5–8):** reviews and Q&A, recommendations, deals and coupons, EMI, returns automation, Hindi.
3. **Phase 3 — Scale (months 9–12):** ShopSphere Plus membership, seller ads, AI shopping assistant, fraud ML, sale-day waiting room.

**Open questions**

- Which payment gateway (Razorpay vs Stripe vs PayU) — decide on fees and UPI success rates.
- Own warehouses (fulfilled-by-us) at launch, or marketplace-only with seller shipping?
- Final brand name ("ShopSphere" is a placeholder).
