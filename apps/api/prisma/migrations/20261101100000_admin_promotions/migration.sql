-- M6.5 staff RBAC, M6.6 lightning deals + bank offers.

-- Staff roles: SUPER_ADMIN | CATALOG | SUPPORT | FINANCE. A user with no rows is not staff.
CREATE TABLE "staff_roles" (
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "staff_roles_pkey" PRIMARY KEY ("user_id", "role"),
    CONSTRAINT "ck_staff_roles_role" CHECK ("role" IN ('SUPER_ADMIN', 'CATALOG', 'SUPPORT', 'FINANCE'))
);

-- Lightning deal on one offer: deal price inside a time window, capped quantity.
CREATE TABLE "lightning_deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "offer_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "deal_price_paise" BIGINT NOT NULL,
    "quantity_cap" INTEGER NOT NULL,
    "claimed_qty" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "lightning_deals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_lightning_deals_qty" CHECK ("quantity_cap" > 0 AND "claimed_qty" >= 0 AND "claimed_qty" <= "quantity_cap"),
    CONSTRAINT "ck_lightning_deals_price" CHECK ("deal_price_paise" > 0),
    CONSTRAINT "ck_lightning_deals_window" CHECK ("ends_at" > "starts_at")
);
CREATE INDEX "idx_lightning_deals_window" ON "lightning_deals"("active", "starts_at", "ends_at");
CREATE INDEX "idx_lightning_deals_offer" ON "lightning_deals"("offer_id");

-- Units of a deal taken by an order (claimed atomically at place-order).
CREATE TABLE "deal_claims" (
    "order_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "deal_claims_pkey" PRIMARY KEY ("order_id", "deal_id")
);

-- Instant discount when paying through a provider (ShopSphere Bank). percent in basis points.
CREATE TABLE "bank_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'bank',
    "percent_bp" INTEGER NOT NULL,
    "max_discount_paise" BIGINT,
    "min_order_paise" BIGINT NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "bank_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_bank_offers_percent" CHECK ("percent_bp" > 0 AND "percent_bp" <= 10000)
);

CREATE TABLE "bank_offer_redemptions" (
    "order_id" UUID NOT NULL,
    "bank_offer_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "bank_offer_redemptions_pkey" PRIMARY KEY ("order_id")
);

CREATE INDEX "idx_audit_logs_created" ON "audit_logs"("created_at");
