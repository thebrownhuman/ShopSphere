import { expect, test, type APIRequestContext } from '@playwright/test';
import { MAILPIT_URL } from '../playwright.config';

/** Poll Mailpit (where the dev notification provider delivers OTPs) for the latest code. */
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

test('sign-up with email OTP, add address, sign out, sign back in with password', async ({
  page,
  request,
}) => {
  const email = `e2e-${Date.now()}@example.test`;
  const password = 'Sphere#2026pass';

  // Protected page bounces to sign-in and remembers where we were going.
  await page.goto('/account/addresses');
  await expect(page).toHaveURL(/\/signin\?returnTo=%2Faccount%2Faddresses/);

  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Verify to create your account' })).toBeVisible();

  await page.getByLabel('6-digit code').fill(await latestOtp(request, email));
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await expect(page.getByRole('heading', { name: 'Almost there' })).toBeVisible();
  await page.getByLabel('Full name').fill('Asha Verma');
  await page.getByLabel('Password (optional)').fill(password);
  await expect(page.getByText('Password strength: Strong')).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();

  // Back at the return-to page, signed in.
  await expect(page).toHaveURL(/\/account\/addresses$/);
  await expect(page.getByRole('heading', { name: 'Your Addresses' })).toBeVisible();
  await expect(page.getByTestId('account-link')).toContainText('Hello, Asha Verma');

  // Address with pincode autofill.
  await page.getByRole('button', { name: 'Add address' }).click();
  await page.getByLabel('Full name').fill('Asha Verma');
  await page.getByLabel('Mobile number').fill('9876543210');
  await page.getByLabel('Pincode').fill('560001');
  await expect(page.getByLabel('City')).toHaveValue('Bengaluru');
  await expect(page.getByLabel('State')).toHaveValue('Karnataka');
  await page.getByLabel('Flat, house no., building, street').fill('12 MG Road');
  await page.getByRole('button', { name: 'Save address' }).click();
  const card = page.getByTestId('address-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Default');
  await expect(card).toContainText('Bengaluru, Karnataka 560001');

  // Session survives a reload (silent refresh from the HttpOnly cookie).
  await page.reload();
  await expect(page.getByTestId('address-card')).toHaveCount(1);

  // Sign out, then sign in with the password.
  await page.goto('/account');
  await expect(page.getByTestId('account-greeting')).toHaveText('Hello, Asha Verma');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('account-link')).toContainText('Hello, Sign in');

  await page.goto('/signin');
  await page.getByLabel('Mobile number or email').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('account-link')).toContainText('Hello, Asha Verma');
});

test('unknown identifier goes to OTP sign-up, never a password prompt', async ({ page }) => {
  await page.goto('/signin');
  await page.getByLabel('Mobile number or email').fill(`nobody-${Date.now()}@example.test`);
  await page.getByRole('button', { name: 'Continue' }).click();
  // Unknown account → OTP sign-up path, never a password prompt.
  await expect(page.getByRole('heading', { name: 'Verify to create your account' })).toBeVisible();
});
