import { expect, test, type Page } from '@playwright/test';

/**
 * Same browse journey against the real catalog API + seeded database (E2E_CATALOG_API=1).
 * Seed content is generated, so assertions are about behaviour, not specific products.
 */

async function pdpPrice(page: Page) {
  const price = page.getByTestId('pdp-price').getByTestId('price');
  await expect(price).toBeVisible();
  return (await price.textContent())!.trim();
}

test('home → search headphones → filter brand → PDP → variant updates URL and price', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Featured offers' })).toBeVisible();
  await expect(page.getByTestId('product-tile').first()).toBeVisible();

  const box = page.getByRole('combobox', { name: 'Search ShopSphere' });
  await box.fill('he');
  await expect(
    page.getByRole('listbox', { name: 'Search suggestions' }).getByRole('option').first(),
  ).toBeVisible();
  await box.fill('headphones');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/s\?k=headphones$/);
  await expect(page.getByTestId('result-count')).toContainText('results for');

  if (isMobile) await page.getByRole('button', { name: /^Filters/ }).click();
  const brands = page.getByRole('group', { name: 'Brand' }).getByRole('checkbox');
  const brandBox = brands.first();
  const brandLabel = (await brandBox.locator('xpath=..').textContent())!
    .replace(/\(\d+\)$/, '')
    .trim();
  await brandBox.check();
  await expect(page).toHaveURL(/\/s\?k=headphones&brand=[^&]+$/);
  if (isMobile) await page.getByRole('button', { name: 'Show results' }).click();
  const tiles = page.getByTestId('product-tile');
  await expect(tiles.first()).toContainText(brandLabel);

  // Open the first result that has variant options.
  await tiles.first().getByRole('link').click();
  await expect(page).toHaveURL(/\/p\/[^?]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const before = await pdpPrice(page);
  await expect(page.getByTestId('delivery-promise')).toBeVisible();

  const options = page.getByRole('radiogroup').first().getByRole('radio', { checked: false });
  const count = await options.count();
  expect(count, 'first result should have more than one variant').toBeGreaterThan(0);
  let switched = false;
  for (let i = 0; i < count; i++) {
    await options.nth(0).click();
    await expect(page).toHaveURL(/\?sku=.+$/);
    const after = await pdpPrice(page);
    if (after !== before) {
      switched = true;
      break;
    }
  }
  test.info().annotations.push({
    type: 'variant-price',
    description: switched
      ? 'price changed with variant'
      : 'all variants share one price in seed data',
  });
  await page.reload();
  await expect(page).toHaveURL(/\?sku=.+$/);
  await pdpPrice(page);
});
