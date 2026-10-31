import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessedEventsService } from './processed-events.service';

function fakePrisma() {
  const seen = new Set<string>();
  const tx = {
    processedEvent: {
      create: jest.fn(async ({ data }: { data: { consumer: string; eventId: string } }) => {
        const k = `${data.consumer}:${data.eventId}`;
        if (seen.has(k)) {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'x',
          });
        }
        seen.add(k);
      }),
    },
  };
  return {
    $transaction: (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  } as unknown as PrismaService;
}

describe('ProcessedEventsService', () => {
  it('runs a handler once per (consumer, event)', async () => {
    const svc = new ProcessedEventsService(fakePrisma());
    const handler = jest.fn().mockResolvedValue(undefined);
    expect(await svc.runOnce('indexer', 'e1', handler)).toBe(true);
    expect(await svc.runOnce('indexer', 'e1', handler)).toBe(false);
    expect(await svc.runOnce('mailer', 'e1', handler)).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('propagates handler errors', async () => {
    const svc = new ProcessedEventsService(fakePrisma());
    await expect(svc.runOnce('c', 'e', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
  });
});
