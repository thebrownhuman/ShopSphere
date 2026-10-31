import { defineConfig, devices } from '@playwright/test';

/**
 * Admin console E2E against the docker-compose stack (`pnpm infra:up`): starts the API on its own
 * database + search index (port 4210; 4200 is taken locally) and the admin app. Orders are paid
 * through the API test toggle, so bank-sim is not needed. Override E2E_DATABASE_URL /
 * E2E_REDIS_URL / E2E_OPENSEARCH_URL / E2E_MAILPIT_URL if your compose ports differ.
 */
const API_PORT = Number(process.env.E2E_ADMIN_API_PORT ?? 4210);
const ADMIN_PORT = Number(process.env.E2E_ADMIN_PORT ?? 3150);
export const API_URL = `http://localhost:${API_PORT}`;
const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://shopsphere:shopsphere@localhost:5440/shopsphere_admin_e2e?schema=public';
const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6390/8';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  // next dev compiles each page on first visit.
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: ADMIN_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // npm run: pnpm may not be on PATH; scripts are plain commands.
      command: 'npm run build && npm run db:deploy && npm run db:seed && npm start',
      cwd: '../api',
      url: `${API_URL}/healthz`,
      timeout: 400_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL,
        REDIS_URL,
        OPENSEARCH_URL: process.env.E2E_OPENSEARCH_URL ?? 'http://localhost:9200',
        SEARCH_INDEX: 'products_admin_e2e',
        SEED_PRODUCTS: '200',
        CORS_ORIGINS: ADMIN_URL,
        WEB_URL: 'http://localhost:3000',
        API_URL,
        RATE_LIMIT_PER_MINUTE: '2000',
        ORDER_WORKERS_ENABLED: 'false',
        PAYMENT_TEST_TOGGLE: 'true',
      },
    },
    {
      command: `npx next dev -p ${ADMIN_PORT}`,
      url: ADMIN_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: API_URL },
    },
  ],
});
