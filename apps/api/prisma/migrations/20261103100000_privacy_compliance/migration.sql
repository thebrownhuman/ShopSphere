-- M7.3 compliance: DPDP export/deletion requests, country of origin (Consumer Protection
-- (E-Commerce) Rules 2020)..

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "object_key" TEXT,
    "error" TEXT,
    "scheduled_for" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_privacy_requests_user" ON "privacy_requests"("user_id", "created_at");
CREATE INDEX "idx_privacy_requests_due" ON "privacy_requests"("kind", "status", "scheduled_for");

-- AlterTable
ALTER TABLE "products" ADD COLUMN "country_of_origin" TEXT NOT NULL DEFAULT 'India';
