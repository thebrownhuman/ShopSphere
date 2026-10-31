# API modules

One folder per bounded context, as in the implementation plan:
identity, catalog, search, pricing, inventory, cart, checkout, order, payment,
notification, review, seller, admin, shared.

Rules:
- A module exposes a Nest module + service API; other modules never import its internals or tables.
- Cross-module side effects go through the outbox (`shared/outbox`), consumed idempotently (`shared/events`).
- `payment` hides gateways (Razorpay test mode, ShopSphere Bank) behind a `PaymentProvider` adapter.
- Money is integer paise (`BigInt` in Prisma / `BIGINT` in SQL). Timestamps are `timestamptz` UTC.
