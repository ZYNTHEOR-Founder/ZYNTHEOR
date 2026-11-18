import { test, expect } from '@playwright/test';
const APP_URL = process.env.BENCHMARK_APP_URL;
test.describe('L4 · E-Commerce checkout integrity', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!APP_URL, 'Benchmark preview URL is not configured');
    await page.goto(APP_URL);
  });
  test('adds a product, calculates totals and confirms an order', async ({ page }) => {
    await expect(page.getByRole('main')).toBeVisible();
    const product = page.getByRole('article').filter({ has: page.getByRole('button', { name: /add to cart/i }) }).first();
    await expect(product).toBeVisible();
    await product.getByRole('button', { name: /add to cart/i }).click();
    await page.getByRole('link', { name: /cart|basket/i }).click();
    await expect(page.getByText(/subtotal/i)).toBeVisible();
    await expect(page.getByText(/tax/i)).toBeVisible();
    await expect(page.getByText(/total/i)).toBeVisible();
    await page.getByRole('button', { name: /checkout|place order/i }).click();
    await expect(page.getByText(/order confirmed|order placed|thank you/i)).toBeVisible();
    await expect(page.getByText(/order #[A-Z0-9-]+/i)).toBeVisible();
  });
  test('rejects invalid quantities and prevents negative totals', async ({ page }) => {
    await page.getByRole('link', { name: /cart|basket/i }).click();
    const quantity = page.getByRole('spinbutton', { name: /quantity/i }).first();
    if (await quantity.count()) {
      await quantity.fill('-5');
      await expect(page.getByText(/invalid quantity|quantity must be positive/i)).toBeVisible();
    }
    const totalText = await page.getByTestId('cart-total').textContent().catch(() => '');
    if (totalText) {
      const amount = Number(totalText.replace(/[^0-9.-]/g, ''));
      expect(Number.isFinite(amount) && amount >= 0).toBeTruthy();
    } else {
      throw new Error('Cart total is not exposed with data-testid="cart-total"');
    }
  });
});
