/** In-memory Redis with TTLs driven by Date.now(), so jest fake timers can expire keys. Test-only. */
export class MemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string) {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string) {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: (string | number)[]) {
    const existing = this.live(key);
    if (args.includes('NX') && existing) return null;
    const exIdx = args.indexOf('EX');
    let expiresAt: number | null = null;
    if (exIdx >= 0) expiresAt = Date.now() + Number(args[exIdx + 1]) * 1000;
    else if (args.includes('KEEPTTL')) expiresAt = existing?.expiresAt ?? null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string) {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(key: string) {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  multi() {
    const ops: (() => [null, unknown])[] = [];
    const chain = {
      incr: (key: string) => {
        ops.push(() => {
          const entry = this.live(key);
          const next = Number(entry?.value ?? 0) + 1;
          this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
          return [null, next];
        });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          const entry = this.live(key);
          if (entry) entry.expiresAt = Date.now() + seconds * 1000;
          return [null, entry ? 1 : 0];
        });
        return chain;
      },
      exec: async () => ops.map((op) => op()),
    };
    return chain;
  }
}
