-- Seller Central (M5.1-M5.2): onboarding/KYC accounts and listing media.
CREATE TABLE "seller_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "seller_id" UUID,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "is_first_party" BOOLEAN NOT NULL DEFAULT false,
    "pan" TEXT,
    "gstin" TEXT,
    "bank_holder_name" TEXT,
    "bank_account_last4" TEXT,
    "bank_account_hash" TEXT,
    "bank_ifsc" TEXT,
    "bank_name_at_bank" TEXT,
    "bank_verify_ref" TEXT,
    "bank_verified_at" TIMESTAMPTZ(6),
    "pickup" JSONB,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "seller_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seller_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "seller_account_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_accounts_user_id_key" ON "seller_accounts"("user_id");
CREATE UNIQUE INDEX "seller_accounts_seller_id_key" ON "seller_accounts"("seller_id");
CREATE INDEX "seller_accounts_status_submitted_at_idx" ON "seller_accounts"("status", "submitted_at");
CREATE INDEX "seller_media_seller_account_id_idx" ON "seller_media"("seller_account_id");

ALTER TABLE "seller_accounts" ADD CONSTRAINT "seller_accounts_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "seller_media" ADD CONSTRAINT "seller_media_seller_account_id_fkey" FOREIGN KEY ("seller_account_id") REFERENCES "seller_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "seller_accounts" ADD CONSTRAINT "seller_accounts_status_check"
  CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'));
