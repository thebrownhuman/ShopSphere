import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(4000);
    expect(env.OUTBOX_PUBLISHER_ENABLED).toBe(false);
  });

  it('lists every invalid key', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/DATABASE_URL.*REDIS_URL|PORT/);
  });
});
