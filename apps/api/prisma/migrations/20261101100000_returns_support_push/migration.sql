-- CreateTable
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "refund_to" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "amount_paise" BIGINT NOT NULL,
    "pickup_date" TEXT NOT NULL,
    "courier" TEXT,
    "awb" TEXT,
    "tracking_seq" INTEGER NOT NULL DEFAULT 0,
    "qc_note" TEXT,
    "picked_up_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6),
    "qc_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_tracking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "return_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "location" TEXT,
    "applied" BOOLEAN NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "order_id" UUID,
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_requests_order_id_key" ON "return_requests"("order_id");

-- CreateIndex
CREATE INDEX "return_requests_user_id_created_at_idx" ON "return_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_returns_seller_status" ON "return_requests"("seller_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_returns_courier_awb" ON "return_requests"("courier", "awb");

-- CreateIndex
CREATE INDEX "return_tracking_events_return_id_occurred_at_idx" ON "return_tracking_events"("return_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_return_tracking_provider_event" ON "return_tracking_events"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "return_tracking_events" ADD CONSTRAINT "return_tracking_events_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

