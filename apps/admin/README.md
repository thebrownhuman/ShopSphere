# Admin console (M6.5–M6.7)

Next.js app for ShopSphere staff, on `packages/ui`. Dev: `corepack pnpm --filter @shopsphere/admin dev`
(port 3003, `NEXT_PUBLIC_API_URL` → the API).

Sign in with the seeded super-admin (`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`, see
`apps/api/.env.example` and `apps/api/prisma/seed-admin.ts`). Grant other staff roles on **Users**.

| Role | Can |
|---|---|
| SUPER_ADMIN | everything, incl. granting roles |
| CATALOG | sellers (KYC queue, suspend), catalog moderation, promotions, home CMS |
| SUPPORT | users (suspend), sellers list, order lookup |
| FINANCE | order lookup, manual refunds, bank offers, audit log |

Roles are enforced by `StaffGuard` in `apps/api/src/modules/admin/rbac.ts`; the nav only hides
what a role can't use. Every admin mutation is written to `audit_logs` by `AdminAuditInterceptor`.

Pages: users, sellers (KYC approval queue), catalog moderation, orders (+ manual refund), promotions
(lightning deals, coupons, bank offers), home page CMS (drag order, schedule, preview), audit log,
reviews (placeholder until the reviews milestone).

E2E: `npx playwright test` (needs `pnpm infra:up`; starts the API on :4210 and the app on :3150).
