import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';

/**
 * Idempotent event consumer helper (M0.15). Runs `handler` at most once per
 * (consumer, eventId): the marker row and the handler's writes share one transaction,
 * so a crash mid-handler rolls both back and the event is safely retried.
 */
@Injectable()
export class ProcessedEventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns true if the handler ran, false if the event was already processed. */
  async runOnce(
    consumer: string,
    eventId: string,
    handler: (tx: Tx) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({ data: { consumer, eventId } });
        await handler(tx);
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }
}
