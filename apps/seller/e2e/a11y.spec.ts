import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { API_URL, INTERNAL_TOKEN, MAILPIT_URL } from '../playwright.config';

/**
 * M7.4: axe-core (WCAG 2.0/2.1 A + AA) on Seller Central's main pages. Fails on serious/critical
 * violations; all results go to `test-results/a11y/seller.json`.
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

async function latestOtp(request: APIRequestContext, to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
      params: { query: `to:"${to}"`, limit: '1' },
    });
    const body = (await res.json()) as { messages?: { Subject: string }[] };
    const match = body.messages?.[0]?.Subject.match(/^(\d{6})\b/);
    if (match) return match[1]!;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no OTP mail for ${to}`);
}

// Valid PAN + GSTIN pair (Karnataka, state code 29); check digit computed like kyc-validation.ts.
const PAN = 'ABCPK1234D';
function gstin(state: string, pan: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first14 = `${state}${pan}1Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return first14 + chars[(36 - (sum % 36)) % 36];
}

test.setTimeout(300_000);

test.afterAll(() => {
  mkdirSync('test-results/a11y', { recursive: true });
  writeFileSync('test-results/a11y/seller.json', JSON.stringify(report, null, 2));
});

test('seller central pages have no serious/critical axe violations', async ({ page, request }) => {
  const run = Date.now().toString(36);
  const email = `seller-a11y-${run}@example.test`;

  await page.goto('/');
  await expect(page).toHaveURL(/\/signin/);
  await scan(page, 'signin');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill(await latestOtp(request, email));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByLabel('Full name').fill('Meera Iyer');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Store display name').fill(`A11y ${run}`);
  await page.getByRole('button', { name: 'Create seller account' }).click();
  await expect(page.getByRole('form', { name: 'Business details' })).toBeVisible();
  await scan(page, 'onboarding');

  // Keyboard: skip link first.
  // Fresh load: the first Tab lands on the skip link.
  await page.reload();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();

  // KYC (same valid PAN/GSTIN pair as seller-onboarding.spec.ts), submit, approve via the queue API.
  const details = page.getByRole('form', { name: 'Business details' });
  await details.getByLabel('Legal name (as on PAN)').fill('Meera Iyer');
  await details.getByLabel('PAN', { exact: true }).fill(PAN);
  await details.getByLabel('GSTIN').fill(gstin('29', PAN));
  await details.getByLabel('Contact name').fill('Meera Iyer');
  await details.getByLabel('Contact phone').fill('9876543210');
  await details.getByLabel('Address line 1').fill('22 Residency Road');
  await details.getByLabel('City').fill('Bengaluru');
  await details.getByLabel('State').fill('Karnataka');
  await details.getByLabel('Pincode').fill('560025');
  await details.getByRole('button', { name: 'Save details' }).click();
  await expect(details.getByText('Details saved')).toBeVisible();
  const bank = page.getByRole('form', { name: 'Bank account' });
  await bank.getByLabel('Account holder name').fill('Meera Iyer');
  await bank.getByLabel('Account number').fill('50100012345678');
  await bank.getByLabel('IFSC').fill('HDFC0001234');
  await bank.getByRole('button', { name: 'Verify bank account' }).click();
  await expect(page.getByTestId('bank-verified')).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByRole('heading', { name: 'Application under review' })).toBeVisible();
  await scan(page, 'onboarding (under review)');
  const applicationId = (await page.getByTestId('application-id').textContent())!.trim();
  const approve = await request.post(
    `${API_URL}/seller/admin/applications/${applicationId}/approve`,
    { headers: { 'x-internal-token': INTERNAL_TOKEN } },
  );
  expect(approve.status()).toBe(200);

  for (const path of [
    '/',
    '/listings/new',
    '/listings/bulk',
    '/inventory',
    '/orders',
    '/returns',
    '/payouts',
    '/questions',
  ]) {
    await page.goto(path);
    await scan(page, path);
  }
});
