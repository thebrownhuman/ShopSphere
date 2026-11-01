import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { BANK_URL, MAILPIT_URL, S3_URL } from '../playwright.checkout-api.config';

/**
 * M4 against the real stack (API + bank-sim + workers): sign up → add to cart → checkout →
 * ShopSphere Bank hosted card page (3-D Secure OTP) → confirmed → GST invoice PDF in S3 and
 * "order confirmed" email in Mailpit; declined card → retry → confirmed; Cash on Delivery.
 */

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

async function signUp(page: Page, request: APIRequestContext): Promise<string> {
  const email = `m4-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  await page.goto('/signin');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const otp = (await mailTo(request, email, /^\d{6}\b/)).slice(0, 6);
  await page.getByLabel('6-digit code').fill(otp);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.getByLabel('Full name').fill('Asha Verma');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('account-link')).toContainText('Hello, Asha');
  return email;
}

async function addToCartAndCheckout(page: Page) {
  await page.goto('/s?k=headphones');
  const tile = page
    .getByTestId('product-tile')
    .filter({ has: page.getByTestId('add-to-cart') })
    .first();
  await tile.getByTestId('add-to-cart').click();
  const drawer = page.getByTestId('added-drawer');
  await expect(drawer.getByRole('heading', { name: '✓ Added to cart' })).toBeVisible();
  await page.goto('/cart');
  await page.getByTestId('proceed-to-buy').first().click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText('Secure checkout')).toBeVisible();

  // New account: no saved address, so step 1 opens on the form.
  const form = page.getByRole('form', { name: 'New address' });
  await form.getByLabel('Full name').fill('Asha Verma');
  await form.getByLabel('Mobile number').fill('9876543210');
  await form.getByLabel('Pincode').fill('560038');
  await form.getByLabel('City').fill('Bengaluru');
  await form.getByLabel('State').fill('Karnataka');
  await form.getByLabel('Flat, house no., building').fill('12, MG Road');
  await form.getByRole('button', { name: 'Save and deliver here' }).click();
  await page.getByRole('button', { name: 'Deliver here' }).click();
}

async function choose(page: Page, method: RegExp) {
  // Controlled by the server session: the radio flips once PATCH /checkout answers.
  await page.getByRole('radio', { name: method }).click();
  await expect(page.getByRole('radio', { name: method })).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function bankCard(page: Page, number: string) {
  await expect(page).toHaveURL(new RegExp(`^${BANK_URL}/checkout`));
  await page.getByLabel('Card number').fill(number);
  await page.getByLabel('Expiry (MM/YY)').fill('12/30');
  await page.getByLabel('CVV').fill('123');
  await page.getByLabel('Name on card').fill('Asha Verma');
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await page.getByLabel('One-time password').fill('123456');
  await page.getByRole('button', { name: 'Submit' }).click();
}

async function confirmed(page: Page): Promise<{ number: string; orderId: string }> {
  await expect(page).toHaveURL(/\/checkout\/result\?/);
  await expect(page.getByRole('heading', { name: /Order placed/ })).toBeVisible({
    timeout: 30_000,
  });
  const number = (await page.getByTestId('order-number').textContent())!.trim();
  const orderId = new URL(page.url()).searchParams.get('orderId')!;
  return { number, orderId };
}

test('ShopSphere Bank card → confirmed → invoice PDF + confirmation email', async ({
  page,
  request,
}) => {
  const email = await signUp(page, request);
  await addToCartAndCheckout(page);
  await choose(page, /ShopSphere Bank/);
  await page.getByTestId('place-order').click();
  await bankCard(page, '4111 1111 1111 1111');
  const { number, orderId } = await confirmed(page);

  await page.getByRole('link', { name: 'View order' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('Order confirmed');
  // The worker renders it from order.confirmed; the button fetches a fresh signed URL per click.
  const invoice = page.getByRole('button', { name: 'Download invoice (PDF)' }).first();
  let signedUrl = '';
  let file = '';
  await expect
    .poll(
      async () => {
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 4_000 }).catch(() => null),
          invoice.click(),
        ]);
        if (!dl) return false;
        signedUrl = dl.url();
        file = (await dl.path())!;
        return true;
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  expect(signedUrl.startsWith(`${S3_URL}/invoices/${orderId}/`)).toBe(true);
  expect(signedUrl).toContain('X-Amz-Signature=');
  const pdf = readFileSync(file);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.toString('latin1')).toContain(number);
  expect(pdf.toString('latin1')).not.toContain('not on file');
  // The bucket is private: the same object without a signature is refused.
  expect((await request.get(signedUrl.split('?')[0]!)).status()).toBe(403);

  await mailTo(request, email, new RegExp(`order ${number} is confirmed`));
});

test('declined card → payment failed → retry → confirmed', async ({ page, request }) => {
  const email = await signUp(page, request);
  await addToCartAndCheckout(page);
  await choose(page, /ShopSphere Bank/);
  await page.getByTestId('place-order').click();
  await bankCard(page, '4000 0000 0000 0002');

  await expect(page.getByRole('heading', { name: 'Payment failed' })).toBeVisible({
    timeout: 30_000,
  });
  await mailTo(request, email, /^Payment failed for order/);
  await page.getByTestId('retry-payment').click();
  await bankCard(page, '5555 5555 5555 4444');
  await confirmed(page);
});

test('Cash on Delivery → confirmed without a gateway', async ({ page, request }) => {
  await signUp(page, request);
  await addToCartAndCheckout(page);
  await choose(page, /Cash on Delivery/);
  const cta = page.getByTestId('place-order');
  await expect(cta).toHaveText('Place Order');
  await cta.click();
  const { orderId } = await confirmed(page);
  await expect(page.getByText('Amount due')).toBeVisible();

  await page.goto('/orders');
  await expect(page.getByTestId('orders')).toBeVisible();
  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId('order-status')).toHaveText('Order confirmed');
});
