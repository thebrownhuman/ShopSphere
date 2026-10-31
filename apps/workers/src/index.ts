/**
 * Worker process entrypoint (webhooks, reconciliation, notifications, indexer).
 * Consumers are added per milestone. Every consumer must be idempotent via
 * ProcessedEventsService (apps/api/src/modules/shared/events).
 */
import { imageOptionsFromEnv, startImageJob } from './images/image.job';
import { handleInvoiceEvent, invoiceOptionsFromEnv } from './invoices/invoice.job';
import { handleNotifyEvent, notifyOptionsFromEnv } from './notifications/notify.job';
import { eventFeedOptionsFromEnv, startEventFeed } from './orders/event-feed';
import { reconcileOptionsFromEnv, startReconcileJob } from './payments/reconcile.job';
import { indexOptionsFromEnv, startIndexJob } from './search/index.job';

console.log(
  JSON.stringify({
    level: 'info',
    msg: 'workers started',
    time: new Date().toISOString(),
  }),
);

const stops = [
  startReconcileJob(reconcileOptionsFromEnv(process.env)),
  startIndexJob(indexOptionsFromEnv(process.env)),
  startImageJob(imageOptionsFromEnv(process.env)),
];

const invoiceOpts = invoiceOptionsFromEnv(process.env);
const notifyOpts = notifyOptionsFromEnv(process.env);
stops.push(
  startEventFeed(eventFeedOptionsFromEnv(process.env), {
    invoices: (e) => handleInvoiceEvent(invoiceOpts, e),
    notifications: (e) => handleNotifyEvent(notifyOpts, e),
  }),
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stops.forEach((stop) => stop());
    process.exit(0);
  });
}
