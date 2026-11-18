import { test, expect } from '@playwright/test';
const APP_URL = process.env.BENCHMARK_APP_URL;
test.describe('L1 · Interactive To-Do application', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!APP_URL, 'Benchmark preview URL is not configured');
    await page.goto(APP_URL);
  });
  test('creates a task and renders it', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /new task|task name|add task/i });
    await expect(input).toBeVisible();
    await input.fill('ZYNTHEOR benchmark task');
    await page.getByRole('button', { name: /add task|add|create task/i }).click();
    await expect(page.getByText('ZYNTHEOR benchmark task', { exact: true })).toBeVisible();
  });
  test('persists a task across reload', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /new task|task name|add task/i });
    await input.fill('Persistent benchmark item');
    await page.getByRole('button', { name: /add task|add|create task/i }).click();
    await page.reload();
    await expect(page.getByText('Persistent benchmark item', { exact: true })).toBeVisible();
  });
  test('completes and deletes a task', async ({ page }) => {
    const input = page.getByRole('textbox', { name: /new task|task name|add task/i });
    await input.fill('Complete then delete');
    await page.getByRole('button', { name: /add task|add|create task/i }).click();
    const row = page.getByText('Complete then delete', { exact: true }).locator('..');
    await row.getByRole('checkbox').check();
    await expect(row).toContainText(/completed|done/i);
    await row.getByRole('button', { name: /delete|remove/i }).click();
    await expect(page.getByText('Complete then delete', { exact: true })).toHaveCount(0);
  });
});
