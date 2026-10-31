import { defineConfig, devices } from '@playwright/test';

/**
 * Catalog E2E on mock data (NEXT_PUBLIC_CATALOG_MOCK=1): needs no API, database or docker.
 * Runs a production build so timings resemble what shoppers get.
 */
const WEB_PORT = Number(process.env.E2E_CATALOG_WEB_PORT ?? 3110);
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /catalog\.spec\.ts/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `next build && next start -p ${WEB_PORT}`,
    url: WEB_URL,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    // The API URL points nowhere on purpose: the catalog must not need it.
    env: {
      NEXT_PUBLIC_CATALOG_MOCK: '1',
      NEXT_PUBLIC_API_URL: 'http://localhost:4999',
      NEXT_PUBLIC_SITE_URL: WEB_URL,
    },
  },
});
