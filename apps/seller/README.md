# Seller Central

Next.js portal for marketplace sellers (Milestone 5): sign-up + KYC, single and bulk listing,
inventory/price table, dashboard. Talks to the API directly with a Bearer access token (seller
auth reuses the identity module: a seller is a user with a seller account).

```bash
corepack pnpm --filter @shopsphere/seller dev   # http://localhost:3002, API from NEXT_PUBLIC_API_URL
corepack pnpm --filter @shopsphere/seller test:e2e
```

The API must list the portal origin in `CORS_ORIGINS`. Approval is an admin action:
`POST /seller/admin/applications/:id/approve` with `x-internal-token` (admin console lands in M6).
