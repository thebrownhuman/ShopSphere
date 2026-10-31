import { defineConfig, devices } from '@playwright/test';

/**
 * Seller Central E2E against the docker-compose stack (`pnpm infra:up`): starts the API (own
 * database + search index so local data is untouched), the seller portal and the storefront.
 * Override E2E_DATABASE_URL / E2E_REDIS_URL / E2E_OPENSEARCH_URL if your compose ports differ.
 */
const API_PORT = Number(process.env.E2E_SELLER_API_PORT ?? 4210);
const SELLER_PORT = Number(process.env.E2E_SELLER_PORT ?? 3130);
const WEB_PORT = Number(process.env.E2E_SELLER_WEB_PORT ?? 3140);
export const API_URL = `http://localhost:${API_PORT}`;
const SELLER_URL = `http://localhost:${SELLER_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  'postgresql://shopsphere:shopsphere@localhost:5440/shopsphere_seller_e2e?schema=public';
const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6390/6';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
export const INTERNAL_TOKEN = 'e2e-seller-internal-token-0123456789';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: SELLER_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // npm run: pnpm may not be on PATH; scripts are plain commands.
      command: 'npm run build && npm run db:deploy && npm run db:seed && npm start',
      cwd: '../api',
      url: `${API_URL}/healthz`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL,
        REDIS_URL,
        OPENSEARCH_URL: process.env.E2E_OPENSEARCH_URL ?? 'http://localhost:9200',
        SEARCH_INDEX: 'products_seller_e2e',
        SEED_PRODUCTS: '200',
        CORS_ORIGINS: `${SELLER_URL},${WEB_URL}`,
        WEB_URL,
        API_URL,
        CATALOG_INTERNAL_TOKEN: INTERNAL_TOKEN,
        RATE_LIMIT_PER_MINUTE: '1000',
        ORDER_WORKERS_ENABLED: 'false',
      },
    },
    {
      command: `npx next dev -p ${SELLER_PORT}`,
      url: SELLER_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: API_URL, NEXT_PUBLIC_STOREFRONT_URL: WEB_URL },
    },
    {
      command: `npx next dev -p ${WEB_PORT}`,
      cwd: '../web',
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_URL: API_URL, NEXT_PUBLIC_SITE_URL: WEB_URL },
    },
  ],
});
