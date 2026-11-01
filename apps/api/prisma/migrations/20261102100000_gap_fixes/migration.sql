-- Gap fixes (M4/M6 follow-ups): invoice data + key, replacement orders, deal claim release.
ALTER TABLE "order_items" ADD COLUMN "hsn_code" TEXT;

ALTER TABLE "shipments" ADD COLUMN "invoice_key" TEXT,
ADD COLUMN "invoice_number" TEXT;

ALTER TABLE "orders" ADD COLUMN "replacement_of_id" UUID;
CREATE INDEX "idx_orders_replacement_of" ON "orders"("replacement_of_id");

ALTER TABLE "return_requests" ADD COLUMN "resolution" TEXT NOT NULL DEFAULT 'REFUND',
ADD COLUMN "replacement_order_id" UUID;

ALTER TABLE "deal_claims" ADD COLUMN "released_at" TIMESTAMPTZ(6);

ALTER TABLE "order_events" ADD COLUMN "courier" TEXT,
ADD COLUMN "awb" TEXT;
