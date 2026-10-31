import type { Tx } from '../shared/prisma/prisma.service';
import type { OutboxService } from '../shared/outbox/outbox.service';

/** Outbox event types the search indexer consumes (M2.9). */
export const CATALOG_EVENTS = ['product.changed', 'offer.changed'] as const;

export function productChanged(outbox: OutboxService, tx: Tx, productId: string) {
  return outbox.enqueue(tx, {
    aggregateType: 'product',
    aggregateId: productId,
    eventType: 'product.changed',
    payload: { productId },
  });
}

/** `stockOnly` marks pure stock moves, which the indexer debounces. */
export function offerChanged(
  outbox: OutboxService,
  tx: Tx,
  e: { offerId: string; skuId: string; productId: string; stockOnly: boolean },
) {
  return outbox.enqueue(tx, {
    aggregateType: 'offer',
    aggregateId: e.offerId,
    eventType: 'offer.changed',
    payload: e,
  });
}
