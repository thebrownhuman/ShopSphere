# @shopsphere/web

Customer site (Next.js 15 App Router, Tailwind, TanStack Query). Root README covers setup.

## Milestone 2 frontend (M2.13–M2.23)

| Route                         | Rendering            | Notes                                                                                                |
| ----------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| `/`                           | ISR 5 min            | hero carousel, quad cards, deals with countdown, product rows (lazy below the fold), recently viewed |
| `/s?k=…&brand=…&page=…`       | dynamic SSR          | filter rail (desktop) / bottom sheet (mobile), sort, 48 per page, did-you-mean, no-results view      |
| `/c/[slug]`                   | dynamic SSR          | same engine as search + breadcrumb and sub-category tiles                                            |
| `/p/[slug]?sku=…`             | ISR 5 min, on demand | gallery (zoom, full screen), variants, specs; buy box is client-only and live                        |
| `/sitemap.xml`, `/robots.txt` | ISR 1 h              |                                                                                                      |
| `/img/<hue>/<label>`          | route handler        | generated SVG placeholder art for the mock catalog (no product photos)                               |

- **Data access** goes only through `src/lib/api/catalog.ts`. By default it calls the catalog API and maps the
  `@shopsphere/types` DTOs to the web view types (`catalog.types.ts`) in `catalog.adapters.ts`.
  `NEXT_PUBLIC_CATALOG_MOCK=1` serves deterministic fixtures from `catalog.mock.ts` instead (lazy-loaded chunk).
- **Live data:** offers (price, stock, sellers) and delivery estimates are fetched on the client with
  `cache: 'no-store'` (TanStack `staleTime` 60 s) and never rendered into ISR HTML. Product JSON-LD in the HTML
  has no price; the schema.org `Offer` is injected client-side from the live offer.
- **Header account state** comes from the client `AuthProvider` (not the `ss_session` cookie) so the layout stays
  static; reading cookies in the root layout would make every page dynamic.
- **Listing URL** vocabulary (`src/lib/search-params.ts`): `k`, `category`, `brand=a,b`, `price=min-max` (rupees),
  `rating`, `discount`, `delivery=plus|tomorrow`, `stock=1`, `a_<attr>=v1,v2`, `sort`, `page`.
- Add to Cart / Buy Now / Wishlist / Notify me render but are unwired until M3. `/cart` is a placeholder.

## Checks

```bash
corepack pnpm --filter @shopsphere/web lint
corepack pnpm --filter @shopsphere/web typecheck
corepack pnpm --filter @shopsphere/web test              # vitest: tile, filters URL sync, variant selector
corepack pnpm --filter @shopsphere/web test:e2e:catalog  # Playwright on mock data, desktop + Pixel 7, no API needed
# Real API + docker-compose (migrates and seeds shopsphere_e2e, API on 4210; needs apps/api/.env):
E2E_CATALOG_API=1 E2E_DATABASE_URL=postgresql://shopsphere:shopsphere@localhost:5440/shopsphere_e2e E2E_REDIS_URL=redis://localhost:6390/5   corepack pnpm --filter @shopsphere/web test:e2e:catalog
```

Lighthouse (mobile, simulated 4G) on a mock build: `NEXT_PUBLIC_CATALOG_MOCK=1 next build && next start -p 3110`,
then `npx lighthouse@12.2.1 http://localhost:3110/`. LCP measured 2.32–2.49 s across `/`, `/s`, `/c`, `/p`; the
home page has the least margin (its hero banner is the LCP element and Lantern charges the ~150 kB of framework JS).
