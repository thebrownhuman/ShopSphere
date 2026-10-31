import type Redis from 'ioredis';
import type { CategoryTreeService } from '../catalog/category-tree.service';
import type { ProductLoader } from '../catalog/product-loader';
import type { PrismaService } from '../shared/prisma/prisma.service';
import type { OpenSearchClient } from './opensearch.client';
import { INDEXER_CONSUMER, SearchIndexerService } from './search-indexer.service';

/** Just the Redis surface the indexer uses: SET PX/NX, EXISTS and a set. TTLs follow Date.now(). */
class FakeRedis {
  private keys = new Map<string, number>();
  private sets = new Map<string, Set<string>>();
  private alive(k: string) {
    const exp = this.keys.get(k);
    if (exp !== undefined && exp <= Date.now()) this.keys.delete(k);
    return this.keys.has(k);
  }
  async set(k: string, _v: string, ...args: (string | number)[]) {
    if (args.includes('NX') && this.alive(k)) return null;
    this.keys.set(k, Date.now() + Number(args[args.indexOf('PX') + 1]));
    return 'OK';
  }
  async exists(k: string) {
    return this.alive(k) ? 1 : 0;
  }
  async sadd(k: string, m: string) {
    this.sets.set(k, (this.sets.get(k) ?? new Set()).add(m));
    return 1;
  }
  async smembers(k: string) {
    return [...(this.sets.get(k) ?? [])];
  }
  async srem(k: string, m: string) {
    return this.sets.get(k)?.delete(m) ? 1 : 0;
  }
}

function setup() {
  let pending: { id: string; event_type: string; payload: object }[] = [];
  const prisma = {
    $queryRaw: jest.fn(async () => pending),
    processedEvent: { createMany: jest.fn(async () => ({ count: 0 })) },
    attributeDefinition: { findMany: jest.fn(async () => []) },
  };
  const indexer = new SearchIndexerService(
    prisma as unknown as PrismaService,
    {} as OpenSearchClient,
    {} as ProductLoader,
    {} as CategoryTreeService,
    new FakeRedis() as unknown as Redis,
  );
  const indexed: string[][] = [];
  jest.spyOn(indexer, 'indexProducts').mockImplementation(async (ids) => {
    indexed.push([...ids].sort());
    return ids.length;
  });
  return {
    indexer,
    prisma,
    indexed,
    events: (e: typeof pending) => {
      pending = e;
    },
  };
}

const ev = (id: string, productId: string, stockOnly = false, type = 'offer.changed') => ({
  id,
  event_type: type,
  payload: { productId, stockOnly },
});

describe('SearchIndexerService.processPending', () => {
  it('reindexes content changes at once and marks events processed', async () => {
    const t = setup();
    t.events([ev('e1', 'p1', false, 'product.changed'), ev('e2', 'p2'), ev('e3', 'p1')]);
    expect(await t.indexer.processPending()).toEqual({ events: 3, indexed: 2, deferred: 0 });
    expect(t.indexed).toEqual([['p1', 'p2']]);
    expect(t.prisma.processedEvent.createMany).toHaveBeenCalledWith({
      data: ['e1', 'e2', 'e3'].map((eventId) => ({ consumer: INDEXER_CONSUMER, eventId })),
      skipDuplicates: true,
    });
  });

  it('debounces stock-only changes per product and flushes them once the window passes', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-31T00:00:00Z') });
    try {
      const t = setup();
      t.events([ev('e1', 'p1', true)]);
      expect(await t.indexer.processPending()).toMatchObject({ indexed: 1, deferred: 0 });

      t.events([ev('e2', 'p1', true), ev('e3', 'p1', true)]);
      expect(await t.indexer.processPending()).toMatchObject({ indexed: 0, deferred: 2 });

      t.events([]);
      expect(await t.indexer.processPending()).toMatchObject({ indexed: 0 });

      jest.advanceTimersByTime(61_000);
      expect(await t.indexer.processPending()).toMatchObject({ indexed: 1 });
      expect(await t.indexer.processPending()).toMatchObject({ indexed: 0 });
      expect(t.indexed).toEqual([['p1'], [], [], ['p1'], []]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a content change flushes a deferred stock change for the same product', async () => {
    const t = setup();
    t.events([ev('e1', 'p1', true)]);
    await t.indexer.processPending();
    t.events([ev('e2', 'p1', true)]);
    await t.indexer.processPending();
    t.events([ev('e3', 'p1', false)]);
    expect(await t.indexer.processPending()).toMatchObject({ indexed: 1 });
    t.events([]);
    expect(await t.indexer.processPending()).toMatchObject({ indexed: 0 });
  });
});
