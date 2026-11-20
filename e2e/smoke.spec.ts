import { expect, test } from '@playwright/test';

test('opens an example and shows the field names of its version', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./');
  await page.getByText('One zone, uncontrolled').click();
  await expect(page.locator('.file-meta')).toContainText('v26.2');

  await page.getByRole('button', { name: /BuildingSurface:Detailed/ }).click();
  await expect(page.getByText('Vertex 1 X-coordinate').first()).toBeVisible();
  await expect(page.getByText('Space Name').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('opens a local 8.2 file with its own schema', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/1ZoneUncontrolled-8.2.idf');
  await expect(page.locator('.file-meta')).toContainText('v8.2');
  await page.getByRole('button', { name: /BuildingSurface:Detailed/ }).click();
  await expect(page.getByText('Vertex 1 X-coordinate').first()).toBeVisible();
  await expect(page.getByText('Space Name')).toHaveCount(0);
});

test('opens the large hospital example', async ({ page }) => {
  await page.goto('./');
  await page.getByText('Low-energy hospital').click();
  await expect(page.locator('.file-meta')).toContainText('6,876 objects', { timeout: 30_000 });
});
