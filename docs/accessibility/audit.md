# Accessibility audit — WCAG 2.1 AA (M7.4)

Date: 1 November 2026. Scope: storefront (`apps/web`), Seller Central (`apps/seller`), admin
console (`apps/admin`), shared components (`packages/ui`).

## 1. Automated checks (axe-core 4.10 via `@axe-core/playwright`)

Rule tags: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. The suites fail on any **serious** or
**critical** violation and write every finding (all impacts) to `test-results/a11y/<app>.json`.
All runs are against the real stack (API 4210, bank-sim 4110, web 3130).

| Suite | Command | Pages scanned |
| --- | --- | --- |
| Storefront | `corepack pnpm --filter @shopsphere/web exec playwright test -c playwright.checkout-api.config.ts e2e/a11y.spec.ts` | home (with and without cookie banner), search, PDP, cart (empty and with item), added-to-cart drawer, sign-in, checkout (address step), orders, account, Login & Security, Privacy & data, `/privacy`, `/terms`, `/returns-policy`, `/grievance` |
| Seller Central | `corepack pnpm --filter @shopsphere/seller exec playwright test e2e/a11y.spec.ts` | sign-in, onboarding (KYC form, under review), dashboard, add listing, bulk upload, inventory, orders, returns, payouts, customer questions |
| Admin | `corepack pnpm --filter @shopsphere/admin exec playwright test e2e/a11y.spec.ts` | sign-in, dashboard, catalog, orders, sellers, users, reviews, promotions, home CMS, audit log |

### Results

Final run: **0 violations of any impact on all 38 page states** (17 storefront, 11 seller, 10 admin).

Violations found on the first runs and fixed:

| Rule (impact) | Where | Fix |
| --- | --- | --- |
| `color-contrast` (serious) | Primary button `bg-accent` (#fb641b, white text 3.0:1) — every storefront form and the cookie banner | `Button` primary now `bg-accent-dark` (#c2410c, 5.2:1), hover `accent-darker` |
| `color-contrast` (pre-empted) | `brand` blue #2874f0 text/links: 4.33:1 on white, 3.96:1 on the slate-100 page background | Token `brand` → #2266dd (5.2:1 on white, 4.8:1 on slate-100) in web, seller and admin Tailwind configs |
| `color-contrast` (pre-empted) | `text-slate-400` helper text (2.6:1): "Coming soon", sign-in "or", seller tracking rows | `text-slate-500` (4.8:1) |
| `link-in-text-block` (serious) | Cart empty state "continue shopping" link and the Privacy & data breadcrumb distinguished by colour only | Always underlined |

## 2. Keyboard and focus (automated in the suites)

- **Skip link**: the first Tab on every app focuses "Skip to main content"; Enter moves focus to
  `<main id="main" tabindex="-1">`. Added to Seller Central and admin (storefront already had it).
- **Carousels**: hero carousel has prev/next and per-slide buttons, a pause/play control,
  pauses on hover/focus, **now also responds to ←/→ while focus is inside**; off-screen slides
  are `aria-hidden` and their links `tabindex=-1`. Product rows have "Scroll … left/right" buttons.
- **Drawer/modals**: the added-to-cart drawer moves focus to its close button, **now traps Tab
  inside the panel** and **returns focus to the opener on Escape/close**. Bug found by the
  test: the Add to Cart button disabled itself while busy, which dropped focus to `<body>`; it
  now uses `aria-disabled` + `aria-busy` and ignores repeat clicks instead. The shared `Modal`
  already focused itself, closed on Escape and restored focus.
- **Cookie banner**: in the page flow (not an overlay), so it never hides content or traps
  focus; "Essential only" is as prominent as "Accept all"; preferences are a labelled
  `fieldset`; reopening from the footer moves focus to the banner.

## 3. Reduced motion (WCAG 2.3.3)

`prefers-reduced-motion: reduce` disables all transitions/animations in all three apps
(`globals.css`), and the hero carousel starts paused.

## 4. Manual screen-reader pass

No screen reader (NVDA, JAWS, VoiceOver, TalkBack) is available in this build environment, so a
true assistive-technology pass **was not done** and remains open (see §5). What was checked by
hand instead, using the browser accessibility tree (Playwright role/name queries — the same
names a screen reader announces) and reading the markup:

- Landmarks: one `<main>` per page; header/nav/footer navs are labelled (`aria-label` per footer
  column, "Seller", breadcrumb "Breadcrumb"); policy pages have an "On this page" nav and
  `section`s labelled by their headings.
- Headings: one `h1` per page; policy and Privacy & data sections use `h2`.
- Forms: every input in checkout address, sign-in, KYC, listing (incl. the new "Country of
  origin") and admin filters is reachable by its visible label (the suites fill them with
  `getByLabel`).
- Live regions: Privacy & data notices are in `role="status" aria-live="polite"`; the hero
  carousel announces slide changes politely only when paused.
- Dialogs: drawer and re-auth panel are `role="dialog"` labelled by their headings;
  drawer is `aria-modal`.
- Images: product images carry the product title as `alt`; decorative glyphs (carousel dots,
  arrows) are `aria-hidden` with labelled buttons.
- Tables: return-window table has a caption and `scope="col"` headers.

## 5. Open items

1. Real screen-reader pass (NVDA + Firefox, VoiceOver + Safari iOS) of sign-in → PDP → cart →
   checkout → order detail, by a human tester.
2. Hindi (`lang="hi"`) content is not live yet; when it is, mark mixed-language strings with
   `lang`.
3. Zoom/reflow (400 %, 320 px width, WCAG 1.4.10) was not tested in this pass.
4. axe covers roughly a third of WCAG success criteria; content-level criteria (meaningful
   alt text written by sellers, error-suggestion wording) need periodic manual review.
