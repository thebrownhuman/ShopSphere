/**
 * Worker process entrypoint (webhooks, reconciliation, notifications, indexer).
 * Placeholder for M0: consumers are added per milestone. Every consumer must be
 * idempotent via ProcessedEventsService (apps/api/src/modules/shared/events).
 */
console.log(
  JSON.stringify({
    level: 'info',
    msg: 'workers placeholder started',
    time: new Date().toISOString(),
  }),
);
