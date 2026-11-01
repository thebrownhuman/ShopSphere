import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { WaitingRoomStatus } from '@shopsphere/types';
import { MetricsService } from '../shared/metrics/metrics.service';
import { REDIS } from '../shared/redis/redis.module';

/**
 * Sale-day waiting room (M7.5): a FIFO queue drained by a Redis token bucket in front of
 * checkout. Each shopper takes a ticket once; the bucket refills at RATE tokens/s (up to BURST)
 * and every token moves the queue head forward by one. Shoppers at or behind the head get a pass
 * valid for PASS_TTL, so the rest of their checkout (patch, place order, pay) is never queued.
 *
 * Feature flag: env WAITING_ROOM_ENABLED, overridden at runtime by Redis `flags:waiting_room`
 * ("on"/"off", set via POST /waiting-room/internal/flag). Fails open if Redis is down.
 */
const ADMIT = `
local bucket, head, seq, pass, ticketKey = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5]
local rate, burst, now, passTtl = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
if redis.call('EXISTS', pass) == 1 then return {1, 0} end
local ticket = tonumber(redis.call('GET', ticketKey))
if not ticket then
  ticket = redis.call('INCR', seq)
  redis.call('SET', ticketKey, ticket, 'EX', 3600)
end
local b = redis.call('HMGET', bucket, 'tokens', 'ts')
local tokens, ts = tonumber(b[1]) or burst, tonumber(b[2]) or now
tokens = math.min(burst, tokens + (now - ts) / 1000 * rate)
local h = tonumber(redis.call('GET', head)) or 0
local want = ticket - h
if want > 0 and tokens >= want then
  tokens = tokens - want
  h = ticket
  redis.call('SET', head, h)
end
redis.call('HSET', bucket, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', bucket, 3600000)
if ticket <= h then
  redis.call('SET', pass, 1, 'EX', passTtl)
  redis.call('DEL', ticketKey)
  return {1, 0}
end
return {0, ticket - h}
`;

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class WaitingRoomService {
  private readonly logger = new Logger(WaitingRoomService.name);
  readonly rate = num(process.env.WAITING_ROOM_RATE_PER_SEC, 20);
  readonly burst = num(process.env.WAITING_ROOM_BURST, 50);
  readonly passTtlSeconds = num(process.env.WAITING_ROOM_PASS_TTL_SEC, 900);
  private readonly envEnabled = process.env.WAITING_ROOM_ENABLED === 'true';

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  async enabled(): Promise<boolean> {
    try {
      const flag = await this.redis.get('flags:waiting_room');
      if (flag === 'on') return true;
      if (flag === 'off') return false;
    } catch {
      /* fall back to env */
    }
    return this.envEnabled;
  }

  async setFlag(state: 'on' | 'off' | 'env'): Promise<void> {
    if (state === 'env') await this.redis.del('flags:waiting_room');
    else await this.redis.set('flags:waiting_room', state);
  }

  /** Takes (or keeps) the shopper's place in line and admits them if the bucket allows. */
  async admit(userId: string, now = Date.now()): Promise<WaitingRoomStatus> {
    if (!(await this.enabled()))
      return { enabled: false, admitted: true, position: 0, retryAfterSeconds: 0 };
    try {
      const [admitted, position] = (await this.redis.eval(
        ADMIT,
        5,
        'wr:bucket',
        'wr:head',
        'wr:seq',
        `wr:pass:${userId}`,
        `wr:ticket:${userId}`,
        this.rate,
        this.burst,
        now,
        this.passTtlSeconds,
      )) as [number, number];
      this.metrics.waitingRoom.inc({ decision: admitted ? 'admitted' : 'queued' });
      return {
        enabled: true,
        admitted: admitted === 1,
        position,
        retryAfterSeconds: admitted
          ? 0
          : Math.max(1, Math.min(30, Math.ceil(position / this.rate))),
      };
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'waiting room unavailable, admitting');
      return { enabled: true, admitted: true, position: 0, retryAfterSeconds: 0 };
    }
  }
}
