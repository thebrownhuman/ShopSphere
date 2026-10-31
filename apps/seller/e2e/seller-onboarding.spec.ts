import { expect, test, type APIRequestContext } from '@playwright/test';
import { API_URL, INTERNAL_TOKEN, MAILPIT_URL, WEB_URL } from '../playwright.config';

/**
 * M5 seller journey: sign up → KYC (PAN, GSTIN, pickup, penny drop) → submit → approved via the
 * admin API → single listing with variants and an image → visible on the storefront search.
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

// Valid PAN + GSTIN pair (Karnataka, state code 29); check digit computed like kyc-validation.ts.
const PAN = 'ABCPK1234D';
function gstin(state: string, pan: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first14 = `${state}${pan}1Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return first14 + chars[(36 - (sum % 36)) % 36];
}
// 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

test('seller signs up, passes KYC, gets approved, lists a product that shows on the storefront', async ({
  page,
  request,
}) => {
  const run = Date.now().toString(36);
  const email = `seller-${run}@example.test`;
  const title = `Quillwick Notebook ${run}`;

  // Sign up with an email OTP.
  await page.goto('/');
  await expect(page).toHaveURL(/\/signin/);
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill(await latestOtp(request, email));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByLabel('Full name').fill('Meera Iyer');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Seller account + KYC.
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Store display name').fill(`Quillwick ${run}`);
  await page.getByRole('button', { name: 'Create seller account' }).click();

  const details = page.getByRole('form', { name: 'Business details' });
  await details.getByLabel('Legal name (as on PAN)').fill('Meera Iyer');
  await details.getByLabel('PAN', { exact: true }).fill('BADPAN');
  await details.getByLabel('GSTIN').fill(gstin('29', PAN));
  await details.getByLabel('Contact name').fill('Meera Iyer');
  await details.getByLabel('Contact phone').fill('9876543210');
  await details.getByLabel('Address line 1').fill('22 Residency Road');
  await details.getByLabel('City').fill('Bengaluru');
  await details.getByLabel('State').fill('Karnataka');
  await details.getByLabel('Pincode').fill('560025');
  await details.getByRole('button', { name: 'Save details' }).click();
  await expect(details.getByText('PAN must look like ABCPE1234F').first()).toBeVisible();
  await details.getByLabel('PAN', { exact: true }).fill(PAN);
  await details.getByRole('button', { name: 'Save details' }).click();
  await expect(details.getByText('Details saved')).toBeVisible();

  const bank = page.getByRole('form', { name: 'Bank account' });
  await bank.getByLabel('Account holder name').fill('Meera Iyer');
  await bank.getByLabel('Account number').fill('50100012345678');
  await bank.getByLabel('IFSC').fill('HDFC0001234');
  await bank.getByRole('button', { name: 'Verify bank account' }).click();
  await expect(page.getByTestId('bank-verified')).toContainText('A/c ending 5678');

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByRole('heading', { name: 'Application under review' })).toBeVisible();
  const applicationId = (await page.getByTestId('application-id').textContent())!.trim();

  // Admin approves through the queue API.
  const approve = await request.post(
    `${API_URL}/seller/admin/applications/${applicationId}/approve`,
    { headers: { 'x-internal-token': INTERNAL_TOKEN } },
  );
  expect(approve.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: "You're approved" })).toBeVisible();

  // Single listing: category → attributes → variants → image → publish.
  await page.getByRole('link', { name: 'Add a listing' }).first().click();
  await expect(page).toHaveURL(/\/listings\/new/);
  const category = page.getByLabel('Category', { exact: true });
  await expect(category.locator('option')).not.toHaveCount(1);
  const values = await category
    .locator('option')
    .evaluateAll((opts) =>
      opts.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent ?? '' })),
    );
  const pick = values.find((o) => o.value && /electronics/i.test(o.label)) ?? values[1];
  await category.selectOption(pick.value);
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Brand', { exact: true }).fill('Quillwick');
  await page.getByLabel('Description').fill('Hand-stitched dotted notebook');
  const variantInputs = page.getByLabel(/ values$/);
  if ((await variantInputs.count()) > 0) await variantInputs.first().fill('Indigo, Saffron');
  const rows = page.getByTestId('variant-row');
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    await row.getByLabel(/^Price for/).fill('349');
    await row.getByLabel(/^MRP for/).fill('599');
    await row.getByLabel(/^Stock for/).fill('20');
  }
  await page.getByLabel(/Upload images/).setInputFiles({
    name: 'notebook.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.getByTestId('uploaded-image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Publish listing' }).click();
  await expect(page.getByTestId('listing-created')).toContainText(`Created ${n} SKU(s)`);

  // Inventory shows the new SKUs; inline edit the first one's stock.
  await page.getByRole('link', { name: 'Inventory & prices' }).click();
  const invRow = page.getByTestId('inventory-row').filter({ hasText: title }).first();
  await invRow.getByLabel(/^Stock for/).fill('35');
  await invRow.getByRole('button', { name: 'Save' }).click();
  await expect(invRow.getByRole('button', { name: 'Save' })).toBeDisabled();

  // Fulfilment routes accept the newly approved seller (seller_users link written on approval).
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.getByText('No orders in this view.')).toBeVisible();

  // Visible on the storefront.
  await page.goto(`${WEB_URL}/s?k=${encodeURIComponent(`Quillwick ${run}`)}`);
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({ timeout: 60_000 });
});
