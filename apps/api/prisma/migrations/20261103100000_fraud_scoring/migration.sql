-- M7.2 fraud scoring v1
ALTER TABLE "orders" ADD COLUMN "fraud_hold" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "fraud_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID,
    "user_id" UUID NOT NULL,
    "checkout_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "payment_method" TEXT NOT NULL,
    "total_paise" BIGINT NOT NULL,
    "ip" TEXT,
    "device_id" TEXT,
    "review_status" TEXT NOT NULL DEFAULT 'NONE',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fraud_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fraud_assessments_order_id_key" ON "fraud_assessments"("order_id");
CREATE INDEX "idx_fraud_user_created" ON "fraud_assessments"("user_id", "created_at");
CREATE INDEX "idx_fraud_device_created" ON "fraud_assessments"("device_id", "created_at");
CREATE INDEX "idx_fraud_ip_created" ON "fraud_assessments"("ip", "created_at");
CREATE INDEX "idx_fraud_review_created" ON "fraud_assessments"("review_status", "created_at");
