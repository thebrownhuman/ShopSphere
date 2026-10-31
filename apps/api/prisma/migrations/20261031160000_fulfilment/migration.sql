-- M5.5–M5.7: seller order queue, courier shipments + tracking, serviceability snapshot, settlement.

-- Seller <-> user link (seller portal sign-in). Written by seller onboarding (M5.1).
CREATE TABLE "seller_users" (
    "user_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_users_pkey" PRIMARY KEY ("user_id")
);
CREATE INDEX "seller_users_seller_id_idx" ON "seller_users"("seller_id");

-- Shipment fulfilment fields.
ALTER TABLE "shipments"
    ADD COLUMN "weight_grams" INTEGER,
    ADD COLUMN "courier" TEXT,
    ADD COLUMN "awb" TEXT,
    ADD COLUMN "shipping_cost_paise" BIGINT,
    ADD COLUMN "tracking_seq" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "accepted_at" TIMESTAMPTZ(6),
    ADD COLUMN "packed_at" TIMESTAMPTZ(6),
    ADD COLUMN "label_at" TIMESTAMPTZ(6),
    ADD COLUMN "shipped_at" TIMESTAMPTZ(6),
    ADD COLUMN "out_for_delivery_at" TIMESTAMPTZ(6),
    ADD COLUMN "delivered_at" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "uq_shipments_courier_awb" ON "shipments"("courier", "awb");
CREATE INDEX "idx_shipments_seller_status" ON "shipments"("seller_id", "status", "created_at");

-- Every tracking event received; provider_event_id makes webhook replays no-ops.
CREATE TABLE "shipment_tracking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "location" TEXT,
    "applied" BOOLEAN NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_tracking_provider_event" ON "shipment_tracking_events"("provider", "provider_event_id");
CREATE INDEX "idx_tracking_shipment" ON "shipment_tracking_events"("shipment_id", "occurred_at");
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_shipment_id_fkey"
    FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Courier serviceability + SLA matrix, refreshed nightly (M5.6a). Latest row wins.
CREATE TABLE "courier_serviceability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "matrix" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "courier_serviceability_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_courier_serviceability_fetched" ON "courier_serviceability"("fetched_at");

-- Settlement (M5.7).
CREATE TABLE "payout_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cutoff_at" TIMESTAMPTZ(6) NOT NULL,
    "payout_count" INTEGER NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seller_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "batch_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "bank_payout_id" TEXT,
    "utr" TEXT,
    "failure_reason" TEXT,
    "line_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),
    CONSTRAINT "seller_payouts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "idx_seller_payouts_seller" ON "seller_payouts"("seller_id", "created_at");
CREATE INDEX "idx_seller_payouts_status" ON "seller_payouts"("status");
ALTER TABLE "seller_payouts" ADD CONSTRAINT "seller_payouts_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "payout_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "settlement_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "seller_id" UUID NOT NULL,
    "gross_paise" BIGINT NOT NULL,
    "taxable_paise" BIGINT NOT NULL,
    "commission_paise" BIGINT NOT NULL,
    "fees_gst_paise" BIGINT NOT NULL,
    "shipping_fee_paise" BIGINT NOT NULL,
    "tcs_paise" BIGINT NOT NULL,
    "tds_paise" BIGINT NOT NULL,
    "net_paise" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "delivered_at" TIMESTAMPTZ(6) NOT NULL,
    "eligible_at" TIMESTAMPTZ(6) NOT NULL,
    "payout_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "settlement_lines_shipment_id_key" ON "settlement_lines"("shipment_id");
CREATE INDEX "idx_settlement_lines_due" ON "settlement_lines"("status", "eligible_at");
CREATE INDEX "idx_settlement_lines_seller" ON "settlement_lines"("seller_id", "delivered_at");
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_payout_id_fkey"
    FOREIGN KEY ("payout_id") REFERENCES "seller_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma does not model CHECKs: payouts are always positive.
ALTER TABLE "seller_payouts" ADD CONSTRAINT "seller_payouts_amount_check" CHECK ("amount_paise" > 0);
