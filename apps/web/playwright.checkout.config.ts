import { defineConfig, devices } from '@playwright/test';

/**
 * Checkout E2E on mocks (NEXT_PUBLIC_CHECKOUT_MOCK=1 + NEXT_PUBLIC_CATALOG_MOCK=1): no API,
 * database or docker. The cart API is stubbed per test with page.route; checkout, payment and
 * orders run on the in-browser mock, with /checkout/mock-bank standing in for bank-sim.
 */
const WEB_PORT = Number(process.env.E2E_CHECKOUT_WEB_PORT ?? 3120);
const WEB_URL = `http://localhost:${WEB_PORT}`;
export const MOCK_API_URL = 'http://localhost:4999';

export default defineConfig({
  testDir: './e2e',
  testMatch: /checkout\.spec\.ts/,
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `next build && next start -p ${WEB_PORT}`,
    url: WEB_URL,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_CHECKOUT_MOCK: '1',
      NEXT_PUBLIC_CATALOG_MOCK: '1',
      NEXT_PUBLIC_API_URL: MOCK_API_URL,
      NEXT_PUBLIC_SITE_URL: WEB_URL,
    },
  },
});
