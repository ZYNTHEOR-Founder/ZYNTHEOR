import { test, expect } from '@playwright/test';
const APP_URL = process.env.BENCHMARK_APP_URL;
test.describe('L2 · Database-driven blog', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!APP_URL, 'Benchmark preview URL is not configured');
    await page.goto(APP_URL);
  });
  test('creates a post and reads it from the application', async ({ page }) => {
    await page.getByRole('link', { name: /new post|create post/i }).click();
    await page.getByRole('textbox', { name: /title/i }).fill('ZYNTHEOR persisted post');
    await page.getByRole('textbox', { name: /content|body/i }).fill('Database-backed benchmark content.');
    await page.getByRole('button', { name: /publish|save post|create post/i }).click();
    await expect(page.getByRole('heading', { name: 'ZYNTHEOR persisted post' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'ZYNTHEOR persisted post' })).toBeVisible();
  });
  test('edits and deletes a persisted post', async ({ page }) => {
    await page.getByRole('link', { name: /new post|create post/i }).click();
    await page.getByRole('textbox', { name: /title/i }).fill('Post lifecycle check');
    await page.getByRole('textbox', { name: /content|body/i }).fill('Initial body');
    await page.getByRole('button', { name: /publish|save post|create post/i }).click();
    await page.getByRole('button', { name: /edit post|edit/i }).first().click();
    await page.getByRole('textbox', { name: /title/i }).fill('Post lifecycle updated');
    await page.getByRole('button', { name: /save changes|update post/i }).click();
    await expect(page.getByRole('heading', { name: 'Post lifecycle updated' })).toBeVisible();
    await page.getByRole('button', { name: /delete post|delete/i }).first().click();
    await expect(page.getByRole('heading', { name: 'Post lifecycle updated' })).toHaveCount(0);
  });
});
