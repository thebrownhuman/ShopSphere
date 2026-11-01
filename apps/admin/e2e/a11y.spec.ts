import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
// Seeded super-admin (apps/api/prisma/seed-admin.ts; values from ADMIN_SEED_* / .env.example).
import { ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD } from '../../api/prisma/seed-admin';

/**
 * M7.4: axe-core (WCAG 2.0/2.1 A + AA) on the admin console's main pages. Fails on
 * serious/critical violations; all results go to `test-results/a11y/admin.json`.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const report: Record<string, Array<{ id: string; impact: string | null; nodes: number }>> = {};

async function scan(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  report[name] = res.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    nodes: v.nodes.length,
  }));
  const blocking = res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 5)
          .join(' | ')}`,
    );
  expect.soft(blocking, `${name}: serious/critical axe violations`).toEqual([]);
}

test.afterAll(() => {
  mkdirSync('test-results/a11y', { recursive: true });
  writeFileSync('test-results/a11y/admin.json', JSON.stringify(report, null, 2));
});

test('admin console pages have no serious/critical axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin/);
  await scan(page, 'signin');
  await page.getByLabel('Email').fill(ADMIN_SEED_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('admin-name')).toContainText('SUPER_ADMIN');
  await scan(page, 'dashboard');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

  for (const path of [
    '/catalog',
    '/orders',
    '/sellers',
    '/users',
    '/reviews',
    '/promotions',
    '/home-cms',
    '/audit',
  ]) {
    await page.goto(path);
    await scan(page, path);
  }
});
