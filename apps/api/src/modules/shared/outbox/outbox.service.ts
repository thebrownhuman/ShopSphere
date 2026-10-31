import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';

export interface OutboxEventInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Write side of the transactional outbox. Always call with the caller's transaction
 * client so the event commits or rolls back with the domain change.
 */
@Injectable()
export class OutboxService {
  async enqueue(tx: Tx, event: OutboxEventInput): Promise<string> {
    const row = await tx.outboxEvent.create({ data: event, select: { id: true } });
    return row.id;
  }
}
