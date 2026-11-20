import { expect, type Page, test } from '@playwright/test';

async function openExample(page: Page, title: string) {
  await page.goto('./');
  await page.getByText(title).click();
  await expect(page.getByRole('tab', { name: 'Summary' })).toBeVisible();
}

test('opens an example and shows the field names of its version', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'One zone, uncontrolled');
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

test('3D view: clicking a surface opens it in the inspector', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'House with AirflowNetwork');
  await page.getByRole('tab', { name: '3D' }).click();
  const canvas = page.locator('.viewer canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.legend')).toContainText('Outdoors');

  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await expect(page.locator('.inspector-head')).toContainText('BuildingSurface:Detailed');
  await expect(page.locator('.surface-info')).toBeVisible();
  expect(errors).toEqual([]);
});

test('search finds a zone and the inspector shows what uses it', async ({ page }) => {
  await openExample(page, 'House with AirflowNetwork');
  await page.keyboard.press('ControlOrMeta+K');
  await page.locator('.search-dialog input').fill('living zone');
  await expect(page.locator('.search-results')).toContainText('LIVING ZONE');
  await page.keyboard.press('Enter');
  await expect(page.locator('.inspector-head h2')).toHaveText('LIVING ZONE');
  await expect(page.locator('.inspector')).toContainText('Living:North');
});

test('the hospital opens, draws in 3D and lists its problems', async ({ page }) => {
  await openExample(page, 'Low-energy hospital');
  await expect(page.locator('.file-meta')).toContainText('6,876 objects', { timeout: 30_000 });
  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.locator('.viewer canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: /Problems/ }).click();
  await expect(page.locator('table.problems tr')).toHaveCount(4);
});
