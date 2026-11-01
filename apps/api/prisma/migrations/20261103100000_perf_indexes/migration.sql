-- M7.5 load-test tuning (docs/perf/load-test.md). Found from pg_stat_user_tables seq scans and
-- EXPLAIN during the full-journey k6 run: Prisma `include` of relations filters on these FK
-- columns, which had no index, so every order confirmation / payment status read scanned the
-- whole table.
CREATE INDEX "idx_order_items_shipment_id" ON "order_items"("shipment_id");
CREATE INDEX "idx_payment_attempts_payment_id" ON "payment_attempts"("payment_id");
CREATE INDEX "idx_refunds_attempt_id" ON "refunds"("attempt_id");
CREATE INDEX "idx_product_images_sku_id" ON "product_images"("sku_id");

-- Payment-events consumer (order/payment-events.consumer.ts) scans only payment outcomes, oldest
-- first; the general outbox index made it read and filter every other event type too.
-- Partial: not expressible in schema.prisma (same convention as carts_user_active_key).
CREATE INDEX "idx_outbox_events_payment_outcomes" ON "outbox_events"("created_at", "id")
  WHERE "aggregate_type" = 'payment' AND "event_type" IN ('payment.captured', 'payment.failed');

-- payment_webhook_backlog_oldest_seconds gauge (metrics.module.ts), read on every scrape.
CREATE INDEX "idx_payment_attempts_authorized" ON "payment_attempts"("created_at")
  WHERE "status" = 'AUTHORIZED';
