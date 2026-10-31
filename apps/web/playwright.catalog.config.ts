import { defineConfig, devices } from '@playwright/test';

/**
 * Catalog E2E. Default: mock data (NEXT_PUBLIC_CATALOG_MOCK=1), no API, database or docker.
 * E2E_CATALOG_API=1: real API against the docker-compose stack (`pnpm infra:up`), migrated and
 * seeded into the `shopsphere_e2e` database (override E2E_DATABASE_URL / E2E_REDIS_URL / E2E_API_PORT).
 * Runs a production build so timings resemble what shoppers get.
 */
const REAL = process.env.E2E_CATALOG_API === '1';
const WEB_PORT = Number(process.env.E2E_CATALOG_WEB_PORT ?? 3110);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4210);
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;

const web = {
  command: `next build && next start -p ${WEB_PORT}`,
  url: WEB_URL,
  timeout: 300_000,
  reuseExistingServer: !process.env.CI,
  env: {
    NEXT_PUBLIC_CATALOG_MOCK: REAL ? '0' : '1',
    // Mock mode points the API nowhere on purpose: the catalog must not need it.
    NEXT_PUBLIC_API_URL: REAL ? API_URL : 'http://localhost:4999',
    NEXT_PUBLIC_SITE_URL: WEB_URL,
  },
};

const api = {
  // npm run: pnpm may not be on PATH; scripts are plain commands.
  command: 'npm run build && npm run db:deploy && npm run db:seed && npm start',
  cwd: '../api',
  url: `${API_URL}/healthz`,
  timeout: 300_000,
  reuseExistingServer: !process.env.CI,
  env: {
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    DATABASE_URL:
      process.env.E2E_DATABASE_URL ??
      'postgresql://shopsphere:shopsphere@localhost:5432/shopsphere_e2e?schema=public',
    REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/5',
    CORS_ORIGINS: WEB_URL,
    WEB_URL,
    API_URL,
    RATE_LIMIT_PER_MINUTE: '1000',
  },
};

export default defineConfig({
  testDir: './e2e',
  testMatch: REAL ? /catalog-api\.spec\.ts/ : /catalog\.spec\.ts/,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: REAL ? [api, web] : web,
});
