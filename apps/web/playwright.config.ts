import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the docker-compose stack (`pnpm infra:up`). Starts the API and web dev server on
 * their own ports and a dedicated `shopsphere_e2e` database so local data is untouched.
 * Override E2E_DATABASE_URL / E2E_REDIS_URL if your compose ports differ.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 4200);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://shopsphere:shopsphere@localhost:5432/shopsphere_e2e?schema=public';
const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/5';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm prisma migrate deploy && pnpm prisma db seed && pnpm build && pnpm start',
      cwd: '../api',
      url: `${API_URL}/healthz`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL,
        REDIS_URL,
        CORS_ORIGINS: WEB_URL,
        WEB_URL,
        API_URL,
        RATE_LIMIT_PER_MINUTE: '1000',
      },
    },
    {
      command: `pnpm exec next dev -p ${WEB_PORT}`,
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: API_URL },
    },
  ],
});
