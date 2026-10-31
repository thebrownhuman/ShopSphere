/** Minimal in-memory stand-in for the ioredis commands the building blocks use. */
export class FakeRedis {
  store = new Map<string, string>();
  down = false;

  private guard() {
    if (this.down) throw new Error('redis down');
  }

  async ping() {
    this.guard();
    return 'PONG';
  }

  async get(key: string) {
    this.guard();
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: (string | number)[]) {
    this.guard();
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string) {
    this.guard();
    return this.store.delete(key) ? 1 : 0;
  }

  multi() {
    const ops: (() => [null, unknown])[] = [];
    const chain = {
      incr: (key: string) => {
        ops.push(() => {
          const next = Number(this.store.get(key) ?? 0) + 1;
          this.store.set(key, String(next));
          return [null, next];
        });
        return chain;
      },
      expire: () => {
        ops.push(() => [null, 1]);
        return chain;
      },
      exec: async () => {
        this.guard();
        return ops.map((op) => op());
      },
    };
    return chain;
  }

  disconnect() {}
}
