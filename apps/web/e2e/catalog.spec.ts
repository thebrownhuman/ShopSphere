import { expect, test } from '@playwright/test';

/** M2 browse journey on mock catalog data: home -> search -> filter -> PDP -> variant switch. */
test('home → search headphones → filter brand → PDP → variant updates URL and price', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Featured offers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Today's Deals" })).toBeVisible();

  // Search with autocomplete visible after 2 characters.
  const box = page.getByRole('combobox', { name: 'Search ShopSphere' });
  await box.fill('he');
  await expect(page.getByRole('option', { name: /headphones/ }).first()).toBeVisible();
  await box.fill('headphones');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/s\?k=headphones$/);
  await expect(page.getByTestId('result-count')).toContainText('results for');

  // Filter by brand (rail on desktop, bottom sheet on mobile); URL holds the state.
  if (isMobile) await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('checkbox', { name: /^Sony/ }).check();
  await expect(page).toHaveURL(/\/s\?k=headphones&brand=sony$/);
  if (isMobile) await page.getByRole('button', { name: 'Show results' }).click();
  const tiles = page.getByTestId('product-tile');
  await expect(tiles.first()).toBeVisible();
  for (const t of await tiles.all()) await expect(t).toContainText('Sony');

  // Open the PDP.
  await page.getByRole('link', { name: /Sony WH-1000XM5/ }).click();
  await expect(page).toHaveURL(/\/p\/sony-wh-1000xm5-wireless-noise-cancelling-headphones$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sony WH-1000XM5');
  const price = page.getByTestId('pdp-price').getByTestId('price');
  await expect(price).toHaveText('₹26,989');
  await expect(page.getByTestId('delivery-promise')).toContainText('delivery');

  // Switch colour: URL gets ?sku=, price and stock update live, no reload.
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
  await page.getByTestId('variant-colour-blue').click();
  await expect(page).toHaveURL(/\?sku=p_[a-z0-9]+_blue$/);
  await expect(price).toHaveText('₹28,989');
  await expect(page.getByTestId('stock-status')).toHaveText('Only 3 left in stock.');
  expect(
    await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
  ).toBe(true);
  await expect(page.getByRole('radio', { name: 'Midnight Blue' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Shared variant link restores the selection.
  await page.reload();
  await expect(price).toHaveText('₹28,989');
  if (isMobile) await expect(page.getByTestId('mobile-buy-bar')).toContainText('₹28,989');
});

test('no-results view offers spelling help and categories', async ({ page }) => {
  await page.goto('/s?k=hedphones');
  await expect(page.getByText(/Showing results for/)).toContainText('headphone');
  await page.goto('/s?k=zzzzqqqq');
  await expect(page.getByTestId('no-results')).toContainText('Browse related categories');
});
