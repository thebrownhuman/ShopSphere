import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { z } from 'zod';
import { REDIS } from '../shared/redis/redis.module';
import type { NotificationCategory } from './templates';

/**
 * Notification preferences: per category, per channel on/off. Defaults are all on.
 *
 * Stored as one Redis hash per user (`notif:prefs:<userId>`, field `<category>.<channel>` = 0|1)
 * for v1, which keeps this module free of a migration while the order schema lands; move to a
 * Postgres table when preferences grow (marketing opt-ins, WhatsApp, quiet hours).
 */
export type Channel = 'email' | 'sms';
export type NotificationPreferences = Record<NotificationCategory, Record<Channel, boolean>>;

export const CATEGORIES: NotificationCategory[] = ['ORDER_UPDATES', 'PAYMENT_ALERTS'];
const CHANNELS: Channel[] = ['email', 'sms'];

const channelSchema = z.object({ email: z.boolean(), sms: z.boolean() }).partial();
export const preferencesPatchSchema = z
  .object({ ORDER_UPDATES: channelSchema, PAYMENT_ALERTS: channelSchema })
  .partial()
  .strict();
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;

const key = (userId: string) => `notif:prefs:${userId}`;

export function defaults(): NotificationPreferences {
  return {
    ORDER_UPDATES: { email: true, sms: true },
    PAYMENT_ALERTS: { email: true, sms: true },
  };
}

@Injectable()
export class PreferencesStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const raw = await this.redis.hgetall(key(userId));
    const prefs = defaults();
    for (const c of CATEGORIES)
      for (const ch of CHANNELS) {
        const v = raw[`${c}.${ch}`];
        if (v !== undefined) prefs[c][ch] = v === '1';
      }
    return prefs;
  }

  async update(userId: string, patch: PreferencesPatch): Promise<NotificationPreferences> {
    const fields: Record<string, string> = {};
    for (const c of CATEGORIES)
      for (const ch of CHANNELS) {
        const v = patch[c]?.[ch];
        if (v !== undefined) fields[`${c}.${ch}`] = v ? '1' : '0';
      }
    if (Object.keys(fields).length) await this.redis.hset(key(userId), fields);
    return this.get(userId);
  }
}
