import { expect, test, type APIRequestContext } from '@playwright/test';
import type {
  AuthResponse,
  CheckoutSession,
  DealOfferOption,
  HomeResponse,
  PlaceOrderResponse,
} from '@shopsphere/types';
// Seeded super-admin (apps/api/prisma/seed-admin.ts; values from ADMIN_SEED_* / .env.example).
import { ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD } from '../../api/prisma/seed-admin';
import { API_URL, MAILPIT_URL } from '../playwright.config';

/**
 * M6.5–M6.7: admin signs in → creates a lightning deal → it shows in the home deal row →
 * a shopper buys it with ShopSphere Bank (deal price + bank offer) → admin refunds part of it.
 */

async function otpFor(request: APIRequestContext, to: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
      params: { query: `to:"${to}"`, limit: '5' },
    });
    const body = (await res.json()) as { messages?: { Subject: string }[] };
    const hit = body.messages?.find((m) => /^\d{6}\b/.test(m.Subject));
    if (hit) return hit.Subject.slice(0, 6);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no OTP mail to ${to}`);
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Shopper account through the real OTP sign-up (code read from Mailpit). */
async function shopperToken(request: APIRequestContext): Promise<string> {
  const email = `m6-${Date.now()}@example.test`;
  await json(await request.post(`${API_URL}/auth/otp/request`, { data: { identifier: email } }));
  const code = await otpFor(request, email);
  const verify = await json<AuthResponse>(
    await request.post(`${API_URL}/auth/otp/verify`, {
      data: { identifier: email, code, keepSignedIn: false },
    }),
  );
  if (verify.status !== 'signup_required') throw new Error(`unexpected ${verify.status}`);
  const done = await json<AuthResponse>(
    await request.post(`${API_URL}/auth/signup`, {
      data: { signupToken: verify.signupToken, name: 'Ravi Kumar' },
    }),
  );
  if (done.status !== 'authenticated') throw new Error('signup failed');
  return done.accessToken;
}

test('admin: lightning deal on home, bank-offer checkout, manual refund', async ({
  page,
  request,
}) => {
  // Pick a well-stocked offer to put on deal (admin API, same login the UI uses).
  const login = await json<AuthResponse>(
    await request.post(`${API_URL}/auth/login`, {
      data: { identifier: ADMIN_SEED_EMAIL, password: ADMIN_SEED_PASSWORD },
    }),
  );
  if (login.status !== 'authenticated') throw new Error('admin login failed');
  const admin = { Authorization: `Bearer ${login.accessToken}` };
  const options = await json<DealOfferOption[]>(
    await request.get(`${API_URL}/admin/promotions/offers?q=an`, { headers: admin }),
  );
  const offer = options.find((o) => o.availableQty >= 5 && o.pricePaise >= 50_000)!;
  expect(offer).toBeTruthy();
  const dealTitle = `Lightning ${offer.title}`.slice(0, 120) + ` #${Date.now() % 100000}`;
  const dealPrice = Math.floor((offer.pricePaise * 0.7) / 100) * 100;

  // 1. Admin signs in.
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin/);
  await page.getByLabel('Email').fill(ADMIN_SEED_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('admin-name')).toContainText('SUPER_ADMIN');

  // 2. Creates a lightning deal in the promotions builder.
  await page.getByRole('link', { name: 'Promotions', exact: true }).click();
  await page.getByLabel('Find product offer').fill(offer.title);
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await page
    .getByRole('list', { name: 'Offers' })
    .getByRole('button')
    .filter({ hasText: offer.sellerName })
    .first()
    .click();
  await page.getByLabel('Deal title').fill(dealTitle);
  await page.getByLabel('Deal price (₹)').fill(String(dealPrice / 100));
  await page.getByLabel('Quantity cap').fill('5');
  await page.getByRole('button', { name: 'Create deal' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Lightning deal created' }),
  ).toBeVisible();
  const row = page.getByRole('table', { name: 'Lightning deals' }).getByRole('row', {
    name: new RegExp(dealTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  });
  await expect(row).toContainText('0/5 (0%)');

  // 3. It appears in the storefront home deal row (GET /home) and in the CMS preview.
  const home = await json<HomeResponse>(await request.get(`${API_URL}/home`));
  const dealRow = home.sections.find((s) => s.type === 'DEAL_ROW' && s.title === 'Lightning Deals');
  expect(dealRow?.type === 'DEAL_ROW' && dealRow.deals.map((d) => d.product.title)).toContain(
    dealTitle,
  );
  await page.getByRole('link', { name: 'Home page', exact: true }).click();
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('list', { name: 'Preview' })).toContainText(dealTitle);

  // 4. A shopper buys 2 at the deal price, paying with ShopSphere Bank (bank offer applies).
  const shopper = { Authorization: `Bearer ${await shopperToken(request)}` };
  const address = await json<{ id: string }>(
    await request.post(`${API_URL}/me/addresses`, {
      headers: shopper,
      data: {
        name: 'Ravi Kumar',
        phone: '9876543210',
        line1: '12, MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        type: 'home',
      },
    }),
  );
  let session = await json<CheckoutSession>(
    await request.post(`${API_URL}/checkout`, {
      headers: shopper,
      data: {
        source: 'BUY_NOW',
        skuId: offer.skuId,
        sellerId: offer.sellerId,
        qty: 2,
        addressId: address.id,
      },
    }),
  );
  session = await json<CheckoutSession>(
    await request.patch(`${API_URL}/checkout/${session.id}`, {
      headers: shopper,
      data: { paymentMethod: { type: 'ONLINE', provider: 'bank' } },
    }),
  );
  const line = session.shipments.flatMap((s) => s.lines)[0];
  expect(line.offerId).toBe(offer.offerId);
  expect(line.unitPricePaise).toBe(dealPrice);
  expect(session.bankOffer?.title).toBe('10% off with ShopSphere Bank cards');
  expect(session.totals.bankOfferDiscountPaise).toBeGreaterThan(0);
  const placed = await json<PlaceOrderResponse>(
    await request.post(`${API_URL}/checkout/${session.id}/place-order`, {
      headers: { ...shopper, 'Idempotency-Key': `m6-e2e-${Date.now()}` },
      data: { expectedTotalPaise: session.totals.totalPaise },
    }),
  );
  await json(
    await request.post(`${API_URL}/orders/${placed.orderId}/test-payment`, {
      headers: shopper,
      data: { outcome: 'success' },
    }),
  );

  // 5. Admin looks the order up and refunds ₹100 manually.
  await page.getByRole('link', { name: 'Orders', exact: true }).click();
  await page.getByLabel('Order number, order id or customer id').fill(placed.orderNumber);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('link', { name: placed.orderNumber }).click();
  await expect(page.getByRole('heading', { name: `Order ${placed.orderNumber}` })).toBeVisible();
  await page.getByLabel('Refund amount (₹)').fill('100');
  await page.getByLabel('Note (kept in the audit log)').fill('Goodwill credit for late delivery');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Refund', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Refund submitted' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Refunds' })).toContainText('₹100.00');
  await expect(page.getByTestId('refund-totals')).toContainText('/ ₹100.00');

  // Every step above is in the audit log.
  await page.getByRole('link', { name: 'Audit log', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Audit entries' })).toContainText(
    'admin.Orders.refund',
  );
  await expect(page.getByRole('table', { name: 'Audit entries' })).toContainText(
    'admin.Promotions.createDeal',
  );
});
