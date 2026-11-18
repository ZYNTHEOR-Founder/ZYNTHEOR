import { test, expect } from '@playwright/test';
const APP_URL = process.env.BENCHMARK_APP_URL;
test.describe('L3 · Multi-user SaaS authorization and isolation', () => {
  test('registers two users and isolates their private records', async ({ browser }) => {
    test.skip(!APP_URL, 'Benchmark preview URL is not configured');
    const a = await browser.newPage();
    const b = await browser.newPage();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userA = `zyntheor-a-${suffix}@example.test`;
    const userB = `zyntheor-b-${suffix}@example.test`;
    for (const [page, email, marker] of [[a, userA, 'PRIVATE-A'], [b, userB, 'PRIVATE-B']]) {
      await page.goto(APP_URL);
      await page.getByRole('link', { name: /register|sign up|create account/i }).click();
      await page.getByRole('textbox', { name: /email/i }).fill(email);
      await page.getByLabel(/password/i).fill('S3cure-Benchmark-Password!');
      await page.getByRole('button', { name: /register|sign up|create account/i }).click();
      await expect(page.getByText(/dashboard|welcome/i).first()).toBeVisible();
      await page.getByRole('textbox', { name: /note|record|private data/i }).fill(marker);
      await page.getByRole('button', { name: /save|create|add/i }).click();
      await expect(page.getByText(marker, { exact: true })).toBeVisible();
    }
    await a.reload();
    await expect(a.getByText('PRIVATE-A', { exact: true })).toBeVisible();
    await expect(a.getByText('PRIVATE-B', { exact: true })).toHaveCount(0);
    await b.reload();
    await expect(b.getByText('PRIVATE-B', { exact: true })).toBeVisible();
    await expect(b.getByText('PRIVATE-A', { exact: true })).toHaveCount(0);
    await a.close(); await b.close();
  });
  test('rejects unauthenticated access to protected dashboard routes', async ({ page }) => {
    test.skip(!APP_URL, 'Benchmark preview URL is not configured');
    await page.goto(new URL('/dashboard', APP_URL).toString());
    await expect(page).toHaveURL(/login|sign-in|auth/i);
  });
});
