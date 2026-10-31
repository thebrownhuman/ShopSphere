import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  API_URL,
  BANK_URL,
  COURIER_URL,
  DATABASE_URL,
  MAILPIT_URL,
} from '../playwright.returns.config';

/**
 * M6.1 against the real stack (API + bank-sim + courier-sim): shopper pays by ShopSphere Bank
 * card → seller ships → courier delivers → shopper requests a return on "Your Orders" → courier
 * picks it up (webhooks) → seller QC passes on receipt → order Refunded, refund in the gateway.
 */

const COURIER_KEY = 'cs_test_api_key';

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

const newEmail = (who: string) =>
  `m6-${who}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;

async function signUp(page: Page, request: APIRequestContext) {
  const email = newEmail('buyer');
  await page.goto('/signin');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const otp = (await mailTo(request, email, /^\d{6}\b/)).slice(0, 6);
  await page.getByLabel('6-digit code').fill(otp);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.getByLabel('Full name').fill('Asha Verma');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('account-link')).toContainText('Hello, Asha');
}

/** A second user signed up through the API (bearer token), to act as the seller. */
async function apiUser(request: APIRequestContext): Promise<{ id: string; token: string }> {
  const identifier = newEmail('seller');
  await request.post(`${API_URL}/auth/otp/request`, { data: { identifier } });
  const code = (await mailTo(request, identifier, /^\d{6}\b/)).slice(0, 6);
  const verified = await (
    await request.post(`${API_URL}/auth/otp/verify`, { data: { identifier, code } })
  ).json();
  const signed = await (
    await request.post(`${API_URL}/auth/signup`, {
      data: { signupToken: verified.signupToken, name: 'Seller Ops' },
    })
  ).json();
  expect(signed.status).toBe('authenticated');
  return { id: signed.user.id, token: signed.accessToken };
}

async function placePaidOrder(page: Page): Promise<string> {
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
  await page.getByRole('radio', { name: /ShopSphere Bank/ }).click();
  await expect(page.getByRole('radio', { name: /ShopSphere Bank/ })).toBeChecked();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('place-order').click();
  await expect(page).toHaveURL(new RegExp(`^${BANK_URL}/checkout`));
  await page.getByLabel('Card number').fill('4111 1111 1111 1111');
  await page.getByLabel('Expiry (MM/YY)').fill('12/30');
  await page.getByLabel('CVV').fill('123');
  await page.getByLabel('Name on card').fill('Asha Verma');
  await page.getByRole('button', { name: /^Pay ₹/ }).click();
  await page.getByLabel('One-time password').fill('123456');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: /Order placed/ })).toBeVisible({
    timeout: 30_000,
  });
  return new URL(page.url()).searchParams.get('orderId')!;
}

test('delivered order → return → courier pickup → QC on receipt → refunded', async ({
  page,
  request,
}) => {
  await signUp(page, request);
  const orderId = await placePaidOrder(page);

  // Seller: link a seller user to the order's seller, then accept → pack → label.
  const seller = await apiUser(request);
  execFileSync(
    process.execPath,
    [path.join(__dirname, 'support', 'link-seller.cjs'), orderId, seller.id],
    {
      env: { ...process.env, DATABASE_URL },
    },
  );
  const auth = { authorization: `Bearer ${seller.token}` };
  const sellerPost = async (url: string, data: object = {}) => {
    const res = await request.post(`${API_URL}${url}`, { headers: auth, data });
    expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
    return res.json();
  };
  const queue = await (
    await request.get(`${API_URL}/seller/orders?status=CONFIRMED`, { headers: auth })
  ).json();
  const shipment = queue.items.find((s: { orderId: string }) => s.orderId === orderId);
  await sellerPost(`/seller/orders/${shipment.id}/accept`);
  await sellerPost(`/seller/orders/${shipment.id}/pack`, { weightGrams: 400 });
  const { awb } = await sellerPost(`/seller/orders/${shipment.id}/label`);

  // Courier: picked up → out for delivery → delivered (signed webhooks to the API).
  const advance = (id: string) =>
    request.post(`${COURIER_URL}/v1/shipments/${id}/advance`, {
      headers: { 'x-api-key': COURIER_KEY },
    });
  for (let i = 0; i < 3; i++) expect((await advance(awb)).ok()).toBe(true);

  await page.goto(`/orders/${orderId}`);
  await expect(page.getByTestId('order-status')).toHaveText('Delivered', { timeout: 15_000 });

  // Shopper requests the return from "Your Orders".
  await page.getByTestId('return-order').click();
  await page.getByTestId('return-reason').selectOption('DEFECTIVE');
  await page.getByTestId('pickup-1').check();
  await page.getByTestId('refund-ORIGINAL').check();
  await page.getByTestId('confirm-return').click();
  await expect(page.getByTestId('order-status')).toHaveText('Return requested');
  await expect(page.getByTestId('return-status')).toHaveText('Pickup scheduled');

  // Courier picks up the reverse shipment; a replay of its webhooks changes nothing.
  const ret = await (await request.get(`${API_URL}/seller/returns`, { headers: auth })).json();
  const mine = ret.items.find((r: { orderId: string }) => r.orderId === orderId);
  expect(mine.status).toBe('PICKUP_SCHEDULED');
  expect((await advance(mine.awb)).ok()).toBe(true);
  await expect
    .poll(async () => {
      await page.reload();
      return page.getByTestId('order-status').textContent();
    })
    .toBe('Picked up');
  await request.post(`${COURIER_URL}/v1/shipments/${mine.awb}/replay`, {
    headers: { 'x-api-key': COURIER_KEY },
  });
  for (let i = 0; i < 2; i++) expect((await advance(mine.awb)).ok()).toBe(true);
  await expect
    .poll(async () => {
      const list = await (
        await request.get(`${API_URL}/seller/returns?status=RECEIVED`, { headers: auth })
      ).json();
      return list.items.some((r: { id: string }) => r.id === mine.id);
    })
    .toBe(true);

  // Seller QC passes on receipt → refund to the original card.
  const qc = await sellerPost(`/seller/returns/${mine.id}/qc`, { result: 'PASS' });
  expect(qc.status).toBe('REFUNDED');

  await page.reload();
  await expect(page.getByTestId('order-status')).toHaveText('Refunded');
  await expect(page.getByTestId('return-status')).toHaveText('Refunded');
});
