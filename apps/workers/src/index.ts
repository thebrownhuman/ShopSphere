/**
 * Worker process entrypoint (webhooks, reconciliation, notifications, indexer).
 * Consumers are added per milestone. Every consumer must be idempotent via
 * ProcessedEventsService (apps/api/src/modules/shared/events).
 */
import { reconcileOptionsFromEnv, startReconcileJob } from './payments/reconcile.job';

console.log(
  JSON.stringify({
    level: 'info',
    msg: 'workers started',
    time: new Date().toISOString(),
  }),
);

const stops = [startReconcileJob(reconcileOptionsFromEnv(process.env))];

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stops.forEach((stop) => stop());
    process.exit(0);
  });
}
