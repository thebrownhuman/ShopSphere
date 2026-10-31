import { expect, test, type Page } from '@playwright/test';
import type { CartResponse } from '@shopsphere/types';
import { MOCK_API_URL } from '../playwright.checkout.config';

/**
 * M4 checkout journey on mocks: cart → Proceed to Buy → checkout (defaults prefilled, lands on
 * Review) → Pay → ShopSphere Bank hosted page → /checkout/result → confirmation; and a declined
 * payment → "Payment failed" → retry → confirmation → order visible in Your Orders.
 */

const cart: CartResponse = {
  id: 'cart-1',
  pincode: '560038',
  version: 1,
  groups: [
    {
      key: 'g1',
      sellerId: 'seller-ss',
      sellerName: 'ShopSphere Retail',
      fulfilment: 'SHOPSPHERE',
      deliveryDate: '2026-11-04',
      lines: [
        {
          id: 'line-1',
          productId: 'p1',
          skuId: 'sku-phone-1',
          sellerId: 'seller-ss',
          slug: 'redmi-note-13-5g',
          title: 'Redmi Note 13 5G (Arctic White, 128 GB)',
          variant: {},
          image: null,
          sellerName: 'ShopSphere Retail',
          fulfilment: 'SHOPSPHERE',
          qty: 1,
          maxQty: 5,
          unitPrice: 1_699_900,
          mrp: 2_099_900,
          snapshotPrice: 1_699_900,
          lineTotal: 1_699_900,
          inStock: true,
          available: 20,
          deliveryDate: '2026-11-04',
          serviceable: true,
          priceChange: null,
          stockChange: null,
          addedAt: '2026-10-31T09:00:00.000Z',
        },
      ],
    },
  ],
  saved: [],
  summary: {
    itemCount: 1,
    lineCount: 1,
    subtotal: 1_699_900,
    mrpTotal: 2_099_900,
    savings: 400_000,
    deliveryFee: 0,
    total: 1_699_900,
    freeDeliveryThreshold: 49_900,
    freeDeliveryRemaining: 0,
    freeDeliveryEligible: true,
    hasIssues: false,
  },
  limits: { maxLines: 50, maxQtyPerItem: 10 },
};

async function stubApi(page: Page) {
  await page.route(`${MOCK_API_URL}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart') return route.fulfill({ json: cart });
    return route.fulfill({
      status: 401,
      json: { code: 'UNAUTHORIZED', message: 'Sign in required' },
    });
  });
}

async function checkoutFromCart(page: Page) {
  await page.goto('/cart');
  await page.getByTestId('proceed-to-buy').first().click();
  await expect(page).toHaveURL(/\/checkout$/);
  // Stripped header: logo + secure checkout only.
  await expect(page.getByText('Secure checkout')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Categories' })).toHaveCount(0);
  // Saved address + payment default → straight to Review.
  await expect(page.getByTestId('step-3')).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('step-1')).toContainText('Asha Verma');
  await expect(page.getByTestId('shipment')).toHaveCount(2);
  const pay = page.getByTestId('place-order');
  await expect(pay).toHaveText(/^Pay ₹18,797/);
  await pay.click();
  await expect(page).toHaveURL(/\/checkout\/mock-bank\?/);
  await expect(page.getByRole('heading', { name: 'ShopSphere Bank' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubApi(page);
});

test('cart → checkout → ShopSphere Bank → order confirmed', async ({ page }) => {
  await checkoutFromCart(page);
  await page.getByRole('button', { name: 'Approve payment' }).click();

  await expect(page).toHaveURL(/\/checkout\/result\?/);
  await expect(page.getByRole('heading', { name: /Order placed/ })).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())!.trim();
  expect(number).toMatch(/^OD\d+/);

  await page.getByRole('link', { name: 'View order' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('Order confirmed');
  await expect(page.getByText(`Order # ${number}`).first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tracking for shipment 1' })).toBeVisible();
});

test('declined payment → retry → confirmed, then visible in Your Orders', async ({ page }) => {
  await checkoutFromCart(page);
  await page.getByRole('button', { name: 'Decline payment' }).click();

  await expect(page.getByRole('heading', { name: 'Payment failed' })).toBeVisible();
  await expect(page.getByText(/Card declined by issuing bank/)).toBeVisible();
  await page.getByTestId('retry-payment').click();

  await expect(page).toHaveURL(/\/checkout\/mock-bank\?/);
  await page.getByRole('button', { name: 'Approve payment' }).click();
  await expect(page.getByRole('heading', { name: /Order placed/ })).toBeVisible();
  const number = (await page.getByTestId('order-number').textContent())!.trim();

  await page.goto('/orders');
  const orders = page.getByTestId('orders');
  await expect(orders).toContainText(number);
  await orders
    .getByRole('listitem')
    .first()
    .getByRole('link', { name: 'View order details' })
    .click();
  await page.getByTestId('cancel-order').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, cancel order' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('Cancelled');
});
