/**
 * M7.5 waiting room against real Redis (Lua token bucket): FIFO admission, pass reuse, refill,
 * feature flag. REDIS_URL defaults to the compose Redis; db 11 is flushed per test.
 */
import Redis from 'ioredis';
import { MetricsService } from '../src/modules/shared/metrics/metrics.service';
import { WaitingRoomService } from '../src/modules/waiting-room/waiting-room.service';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

describe('WaitingRoomService', () => {
  let redis: Redis;
  let room: WaitingRoomService;

  beforeAll(() => {
    redis = new Redis(url, { db: 11 });
  });
  beforeEach(async () => {
    await redis.flushdb();
    process.env.WAITING_ROOM_RATE_PER_SEC = '2';
    process.env.WAITING_ROOM_BURST = '3';
    room = new WaitingRoomService(redis, new MetricsService());
    await room.setFlag('on');
  });
  afterAll(() => redis.quit());

  it('admits everyone while the flag is off', async () => {
    await room.setFlag('off');
    for (let i = 0; i < 10; i++) expect((await room.admit(`u${i}`)).admitted).toBe(true);
  });

  it('admits a burst, then queues in arrival order and drains at the refill rate', async () => {
    const t = 1_000_000;
    const first = await Promise.all(['a', 'b', 'c'].map((u) => room.admit(u, t)));
    expect(first.every((s) => s.admitted)).toBe(true);

    const d = await room.admit('d', t);
    const e = await room.admit('e', t);
    expect(d).toMatchObject({ admitted: false, position: 1 });
    expect(e).toMatchObject({ admitted: false, position: 2 });

    // Admitted shoppers keep their pass without spending tokens.
    expect((await room.admit('a', t)).admitted).toBe(true);

    // 0.5 s at 2/s = 1 token: d (first in line) gets in, e is still waiting at position 1.
    expect((await room.admit('e', t + 500)).admitted).toBe(false);
    expect((await room.admit('d', t + 500)).admitted).toBe(true);
    expect(await room.admit('e', t + 600)).toMatchObject({ admitted: false, position: 1 });
    expect((await room.admit('e', t + 1100)).admitted).toBe(true);
  });

  it('keeps a queued shopper ticket across polls', async () => {
    const t = 2_000_000;
    for (const u of ['a', 'b', 'c']) await room.admit(u, t);
    const before = await room.admit('late', t);
    const again = await room.admit('late', t);
    expect(again.position).toBe(before.position);
    expect(again.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});
