import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { MAILPIT_URL } from '../playwright.config';

/**
 * M3 cart journey against the real API + seeded catalog: guest add → cart → update qty →
 * sign in → guest cart merged into the account cart (quantities summed).
 */

async function latestOtp(request: APIRequestContext, to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
      params: { query: `to:"${to}"`, limit: '1' },
    });
    const body = (await res.json()) as { messages?: { Subject: string }[] };
    const match = body.messages?.[0]?.Subject.match(/^(\d{6})\b/);
    if (match) return match[1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no OTP mail for ${to}`);
}

const count = (page: Page) => page.getByTestId('cart-count');

async function addFromTile(page: Page, index: number): Promise<string> {
  const tile = page
    .getByTestId('product-tile')
    .filter({ has: page.getByTestId('add-to-cart') })
    .nth(index);
  const title = (await tile.getByRole('heading').textContent())!.trim();
  await tile.getByTestId('add-to-cart').click();
  const drawer = page.getByTestId('added-drawer');
  await expect(drawer.getByRole('heading', { name: '✓ Added to cart' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close added to cart' }).click();
  await expect(drawer).toBeHidden();
  return title;
}

/** Seed data repeats titles across products, so lines are addressed by position (oldest first). */
const qtys = (page: Page) => page.getByTestId('line-qty');

test('guest add → cart → update qty → sign in → cart merged', async ({ page, request }) => {
  const email = `cart-${Date.now()}@example.test`;
  const password = 'Sphere#2026pass';

  // An account that already has one item in its cart.
  await page.goto('/signin');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('6-digit code').fill(await latestOtp(request, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.getByLabel('Full name').fill('Cart Shopper');
  await page.getByLabel('Password (optional)').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('account-link')).toContainText('Hello, Cart Shopper');

  await page.goto('/s?k=headphones');
  const first = await addFromTile(page, 0);
  await expect(count(page)).toHaveText('1');

  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByTestId('account-link')).toContainText('Hello, Sign in');
  await expect(count(page)).toHaveText('0');

  // Guest: same item plus another one.
  await page.goto('/s?k=headphones');
  expect(await addFromTile(page, 0)).toBe(first);
  await addFromTile(page, 1);
  await expect(count(page)).toHaveText('2');

  await page.getByTestId('cart-link').click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByTestId('cart-line')).toHaveCount(2);
  const before = await page.getByTestId('cart-subtotal').textContent();
  await qtys(page).nth(1).selectOption('2');
  await expect(count(page)).toHaveText('3');
  await expect(page.getByTestId('cart-subtotal')).not.toHaveText(before!);
  await expect(page.getByTestId('cart-summary')).toContainText('Subtotal (3 items)');

  // Sign in: the guest cart merges into the account cart.
  await page.goto('/signin?returnTo=%2Fcart');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByTestId('account-link')).toContainText('Hello, Cart Shopper');

  await expect(page.getByTestId('cart-line')).toHaveCount(2);
  // Same SKU in both carts: 1 (account) + 1 (guest). Guest-only line keeps its qty of 2.
  await expect(qtys(page).nth(0)).toHaveValue('2');
  await expect(qtys(page).nth(1)).toHaveValue('2');
  await expect(count(page)).toHaveText('4');
  await expect(page.getByTestId('proceed-to-buy')).toHaveAttribute('href', '/checkout');
});
