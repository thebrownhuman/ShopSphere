import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MAILPIT_URL, WEB_URL } from '../playwright.checkout-api.config';

/**
 * M7.4 accessibility: axe-core (WCAG 2.0/2.1 A + AA rules) on the key storefront pages against the
 * real stack, plus keyboard checks (skip link, carousel, drawer focus, cookie banner). Fails on any
 * serious or critical violation; every result (including moderate/minor) is written to
 * `test-results/a11y/web.json` for docs/accessibility/audit.md.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const report: Record<string, Array<{ id: string; impact: string | null; nodes: number }>> = {};

async function scan(page: Page, name: string) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
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

async function mailTo(request: APIRequestContext, to: string, subject: RegExp): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
      params: { query: `to:"${to}"`, limit: '20' },
    });
    const body = (await res.json()) as { messages?: { Subject: string }[] };
    const hit = body.messages?.find((m) => subject.test(m.Subject));
    if (hit) return hit.Subject;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no mail to ${to} matching ${subject}`);
}


test.setTimeout(300_000);

test.afterAll(() => {
  mkdirSync('test-results/a11y', { recursive: true });
  writeFileSync('test-results/a11y/web.json', JSON.stringify(report, null, 2));
});

test('guest pages: home, search, PDP, cart, policies', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('cookie-banner')).toBeVisible();
  await scan(page, 'home (cookie banner open)');
  await page.getByTestId('consent-essential').click();
  await expect(page.getByTestId('cookie-banner')).toHaveCount(0);
  await scan(page, 'home');

  await page.goto('/s?k=headphones');
  await scan(page, 'search');

  const href = await page
    .getByTestId('product-tile')
    .first()
    .locator('a')
    .first()
    .getAttribute('href');
  await page.goto(href!);
  await expect(page.getByTestId('country-of-origin')).toBeVisible();
  await scan(page, 'pdp');

  await page.goto('/cart');
  await scan(page, 'cart (empty)');

  for (const path of ['/privacy', '/terms', '/returns-policy', '/grievance']) {
    await page.goto(path);
    await scan(page, path);
  }
  await page.goto('/signin');
  await scan(page, 'signin');
});

test('keyboard: skip link, carousel, added-to-cart drawer', async ({ page, context }) => {
  await context.addCookies([
    { name: 'ss_consent', value: 'v1.a0.m0', url: WEB_URL },
  ]);
  await page.goto('/');
  // First Tab lands on the skip link, which moves focus to <main>.
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  // Carousels: scroll buttons are real buttons reachable by keyboard.
  const next = page.getByRole('button', { name: /^Scroll .* right$|^Next/ }).first();
  if (await next.count()) {
    await next.focus();
    await expect(next).toBeFocused();
    await page.keyboard.press('Enter');
  }

  // Added-to-cart drawer takes focus and returns it on Escape.
  await page.goto('/s?k=headphones');
  const add = page
    .getByTestId('product-tile')
    .filter({ has: page.getByTestId('add-to-cart') })
    .first()
    .getByTestId('add-to-cart');
  await add.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByTestId('added-drawer');
  await expect(drawer).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest('[data-testid="added-drawer"]')),
    )
    .toBe(true);
  await scan(page, 'added-to-cart drawer');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(add).toBeFocused();

  await page.goto('/cart');
  await scan(page, 'cart');
});

test('signed-in pages: account, privacy, checkout, orders', async ({ page, request }) => {
  const email = `a11y-${Date.now()}@example.test`;
  await page.goto('/signin');
  await page.getByTestId('consent-essential').click();
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const otp = (await mailTo(request, email, /^\d{6}\b/)).slice(0, 6);
  await page.getByLabel('6-digit code').fill(otp);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.getByLabel('Full name').fill('Asha Verma');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('account-link')).toContainText('Hello, Asha');

  await page.goto('/account');
  await scan(page, 'account');
  await page.goto('/account/security');
  await scan(page, 'account/security');
  await page.goto('/account/privacy');
  await expect(page.getByTestId('request-export')).toBeVisible();
  await scan(page, 'account/privacy');

  // DPDP export end to end: request → archive built → emailed → download link on the page.
  await page.getByTestId('request-export').click();
  await expect(page.getByRole('link', { name: 'Download zip' })).toBeVisible({ timeout: 30_000 });
  await mailTo(request, email, /data export is ready/);

  await page.goto('/orders');
  await scan(page, 'orders');

  await page.goto('/s?k=headphones');
  await page
    .getByTestId('product-tile')
    .filter({ has: page.getByTestId('add-to-cart') })
    .first()
    .getByTestId('add-to-cart')
    .click();
  await expect(page.getByTestId('added-drawer')).toBeVisible();
  await page.goto('/cart');
  await page.getByTestId('proceed-to-buy').first().click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole('form', { name: 'New address' })).toBeVisible();
  await scan(page, 'checkout (address)');
});
