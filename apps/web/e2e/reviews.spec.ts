import { execFileSync } from 'node:child_process';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, MAILPIT_URL } from '../playwright.checkout-api.config';

/**
 * M6.2 against the real stack (runs with playwright.checkout-api.config.ts): sign up → COD order
 * → delivered → write a review on the PDP → it appears with the updated rating; a shopper without
 * a delivered order cannot review.
 *
 * Delivery is simulated in SQL (the seller/courier journey has its own tests): set
 * E2E_PSQL to override the default `docker exec shopsphere-postgres-1 psql …` command.
 */
const PSQL = (
  process.env.E2E_PSQL ??
  'docker exec -i shopsphere-postgres-1 psql -U shopsphere -d shopsphere_m4e2e -At -v ON_ERROR_STOP=1'
).split(' ');

function sql(query: string): string {
  return execFileSync(PSQL[0]!, [...PSQL.slice(1), '-c', query], { encoding: 'utf8' }).trim();
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

async function signUp(page: Page, request: APIRequestContext, name: string): Promise<void> {
  const email = `m6-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  await page.goto('/signin');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const otp = (await mailTo(request, email, /^\d{6}\b/)).slice(0, 6);
  await page.getByLabel('6-digit code').fill(otp);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('account-link')).toContainText(`Hello, ${name.split(' ')[0]}`);
}

/** Places a COD order for the first in-stock headphones result; returns the order id. */
async function codOrder(page: Page): Promise<string> {
  await page.goto('/s?k=headphones');
  const tile = page
    .getByTestId('product-tile')
    .filter({ has: page.getByTestId('add-to-cart') })
    .first();
  await tile.getByTestId('add-to-cart').click();
  await expect(page.getByTestId('added-drawer')).toBeVisible();
  await page.goto('/cart');
  await page.getByTestId('proceed-to-buy').first().click();
  await expect(page).toHaveURL(/\/checkout$/);
  const form = page.getByRole('form', { name: 'New address' });
  await form.getByLabel('Full name').fill('Asha Verma');
  await form.getByLabel('Mobile number').fill('9876543210');
  await form.getByLabel('Pincode').fill('560038');
  await form.getByLabel('City').fill('Bengaluru');
  await form.getByLabel('State').fill('Karnataka');
  await form.getByLabel('Flat, house no., building').fill('12, MG Road');
  await form.getByRole('button', { name: 'Save and deliver here' }).click();
  await page.getByRole('button', { name: 'Deliver here' }).click();
  await page.getByRole('radio', { name: /Cash on Delivery/ }).click();
  await expect(page.getByRole('radio', { name: /Cash on Delivery/ })).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('place-order').click();
  await expect(page.getByRole('heading', { name: /Order placed/ })).toBeVisible({
    timeout: 30_000,
  });
  return new URL(page.url()).searchParams.get('orderId')!;
}

test('delivered order → write review → shows on the PDP with the updated rating', async ({
  page,
  request,
}) => {
  await signUp(page, request, 'Asha Verma');
  const orderId = await codOrder(page);
  expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
  sql(
    `UPDATE shipments SET status='DELIVERED', delivered_at=now() WHERE order_id='${orderId}';` +
      `UPDATE orders SET status='DELIVERED' WHERE id='${orderId}';`,
  );
  const [productId, slug] = sql(
    `SELECT product_id || '|' || slug FROM order_items WHERE order_id='${orderId}' LIMIT 1`,
  ).split('|');

  const before = (await (
    await request.get(`${API_URL}/products/${productId}/reviews/stats`)
  ).json()) as { ratingCount: number; histogram: number[] };

  await page.goto(`/p/${slug}`);
  await page.getByTestId('write-review').click();
  const form = page.getByRole('form', { name: 'Write a review' });
  // The radio is visually hidden behind its star; click the star like a shopper would.
  await form.locator('label', { has: page.getByLabel('1 star', { exact: true }) }).click();
  await expect(form.getByLabel('1 star', { exact: true })).toBeChecked();
  await form.getByLabel('Headline').fill('Not for me');
  await form
    .getByLabel('Your review')
    .fill('Sound is thin and the ear cushions hurt after an hour.');
  await form.getByRole('button', { name: 'Submit review' }).click();
  await expect(form).toBeHidden();

  // The new review and the recomputed aggregate, read live from the API.
  await expect(page.getByTestId('review-count')).toHaveText(
    `${before.ratingCount + 1} global rating${before.ratingCount + 1 === 1 ? '' : 's'}`,
  );
  const after = (await (
    await request.get(`${API_URL}/products/${productId}/reviews/stats`)
  ).json()) as { rating: number; ratingCount: number; histogram: number[] };
  expect(after.histogram[0]).toBe(before.histogram[0]! + 1);
  await expect(page.getByTestId('review-rating')).toHaveText(`${after.rating.toFixed(1)} out of 5`);
  await expect(page.getByTestId('review-ineligible')).toHaveText(/you have reviewed/);

  await page
    .getByRole('group', { name: 'Filter reviews' })
    .getByRole('button', { name: '1 ★' })
    .click();
  const card = page.getByTestId('review-card').filter({ hasText: 'Not for me' });
  await expect(card).toContainText('Asha V.');
  await expect(card).toContainText('Verified Purchase');

  // products.rating_x10 / rating_count (PDP header, search) follow the same aggregate.
  expect(
    sql(`SELECT rating_x10 || '|' || rating_count FROM products WHERE id='${productId}'`),
  ).toBe(`${Math.round(after.rating * 10)}|${after.ratingCount}`);
});

test('shoppers without a delivered order cannot review', async ({ page, request }) => {
  await signUp(page, request, 'Ravi Kumar');
  await page.goto('/s?k=headphones');
  await page.getByTestId('product-tile').first().getByRole('link').first().click();
  await expect(page.getByTestId('review-ineligible')).toHaveText(
    'Only customers who received this product can review it.',
  );
  await expect(page.getByTestId('write-review')).toHaveCount(0);
});
