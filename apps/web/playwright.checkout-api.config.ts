import { defineConfig, devices } from '@playwright/test';

/**
 * Checkout E2E against the real stack: API + bank-sim + workers + web, on the docker-compose
 * infra (`pnpm infra:up`: Postgres, Redis, OpenSearch, Mailpit, SeaweedFS). Uses its own database
 * and search index. Ports avoid 4200 (taken locally): API 4210, bank-sim 4110, web 3130.
 * Override E2E_DATABASE_URL / E2E_REDIS_URL when compose ports differ.
 */
const API_PORT = Number(process.env.E2E_API_PORT ?? 4210);
const BANK_PORT = Number(process.env.E2E_BANK_PORT ?? 4110);
const WEB_PORT = Number(process.env.E2E_CHECKOUT_API_WEB_PORT ?? 3130);
export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const BANK_URL = `http://localhost:${BANK_PORT}`;
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const S3_URL = process.env.E2E_S3_URL ?? 'http://localhost:8333';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://shopsphere:shopsphere@localhost:5440/shopsphere_m4e2e?schema=public';
const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6390/7';

/** Shared by the API and the workers started in global setup. */
export const STACK_ENV = {
  NODE_ENV: 'development',
  API_URL,
  WEB_URL,
  DATABASE_URL,
  REDIS_URL,
  S3_ENDPOINT: S3_URL,
  SEARCH_INDEX: process.env.E2E_SEARCH_INDEX ?? 'products_m4e2e',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: /(checkout-api|reviews)\.spec\.ts/,
  globalSetup: './e2e/checkout-api.setup.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build && npm run db:deploy && npm run db:seed && npm start',
      cwd: '../api',
      url: `${API_URL}/healthz`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...STACK_ENV,
        PORT: String(API_PORT),
        CORS_ORIGINS: WEB_URL,
        RATE_LIMIT_PER_MINUTE: '2000',
        SEED_REINDEX: '1',
        BANK_API_URL: `${BANK_URL}/v1`,
        BANK_CHECKOUT_URL: `${BANK_URL}/checkout`,
        PAYMENT_TEST_TOGGLE: 'true',
      },
    },
    {
      command: 'npm run build && npm start',
      cwd: '../bank-sim',
      url: `${BANK_URL}/dev`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(BANK_PORT),
        WEBHOOK_URL: `${API_URL}/payments/webhooks/bank`,
        ALLOWED_CALLBACK_ORIGINS: WEB_URL,
      },
    },
    {
      command: `next build && next start -p ${WEB_PORT}`,
      url: WEB_URL,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_API_URL: API_URL,
        NEXT_PUBLIC_CHECKOUT_MOCK: '0',
        NEXT_PUBLIC_CATALOG_MOCK: '0',
        NEXT_PUBLIC_SITE_URL: WEB_URL,
      },
    },
  ],
});
