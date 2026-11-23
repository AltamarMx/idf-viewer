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

test('schedules: heat map, usage and zone subpanels', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'Medium office (DOE reference)');
  await page.getByRole('tab', { name: 'Schedules' }).click();
  await page.getByRole('button', { name: /^BLDG_OCC_SCH/ }).click();
  await expect(page.locator('.chart canvas').first()).toBeVisible();
  await expect(page.locator('.split-main')).toContainText('Number of People Schedule Name');

  await page.getByRole('button', { name: 'By zone' }).click();
  await page.locator('.zone-schedule button:not([disabled])').first().click();
  await expect(page.locator('.subpanel')).toHaveCount(1);
  await expect(page.locator('.subpanel canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('loads: zone table, loads over time and occupancy peak', async ({ page }) => {
  await openExample(page, 'Medium office (DOE reference)');
  await page.getByRole('tab', { name: 'Loads' }).click();
  await expect(page.locator('table.zones')).toContainText('Core_bottom');
  await expect(page.locator('.chart canvas').first()).toBeVisible();
  await expect(page.getByText('Peak in the building')).toBeVisible();
});

test('ventilation tab lists openings with their AFN role and shows them in 3D', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'Small office with AirflowNetwork');
  await page.getByRole('tab', { name: 'Ventilation' }).click();
  await expect(page.locator('.windows-notice')).toContainText('AirflowNetwork is on');
  const row = page.locator('.table-row', { hasText: 'Zn001:Wall001:Win001' });
  await expect(row).toContainText('Detailed opening');
  await expect(row).toContainText('ELECTRO-CON-LIGHT');

  await row.getByRole('button', { name: '3D' }).click();
  await expect(page.locator('.surface-info')).toContainText('Zn001:Wall001:Win001');
  await expect(page.locator('.surface-info')).toContainText('AFN: WiOpen1');
  await page.getByLabel('Color by').selectOption('afn');
  await expect(page.locator('.legend')).toContainText('Detailed opening (operable)');
  await expect(page.locator('.legend')).toContainText('Crack (leakage only)');
  expect(errors).toEqual([]);
});

test('airflow network: summary and opening card with ZoneLevel values', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'Small office with AirflowNetwork');
  await page.getByRole('tab', { name: 'Ventilation' }).click();
  await page
    .locator('.table-row', { hasText: 'Zn001:Wall001:Win001' })
    .getByRole('button', { name: 'WiOpen1' })
    .click();
  await expect(page.getByRole('tab', { name: 'Airflow network' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.afn-main')).toContainText('MultizoneWithDistribution');
  const card = page.locator('.afn-card');
  await expect(card).toContainText('Zn001:Wall001:Win001');
  await expect(card).toContainText('WindowVentSched');
  await expect(card.locator('.tag.zone').first()).toBeVisible();
  await expect(card.locator('.opening-diagram')).toHaveCount(3);
  await expect(card).toContainText('VentingSched is above zero');
  // Modulation, opening sets and the Cp of the external node.
  await expect(card.locator('canvas')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('infiltration and ventilation: zones, infiltration and wind and stack openings', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'High-rise apartment building');
  await page.getByRole('tab', { name: 'Ventilation' }).click();
  await page.getByRole('tab', { name: 'Infiltration and ventilation' }).click();
  await page.getByRole('button', { name: 'G SW Apartment', exact: true }).click();
  const flows = page.locator('.flows');
  await expect(flows).toContainText('Showing the objects of G SW Apartment');
  await expect(flows).toContainText('Flow/ExteriorArea');
  await expect(flows).toContainText('DOE-2');
  await expect(flows).toContainText('Wind and stack open area');
  expect(errors).toEqual([]);
});

test('problems panel lists the ventilation mistakes of a file', async ({ page }) => {
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/ventilation/AfnErrors.idf');
  await page.getByRole('tab', { name: /Problems/ }).click();
  const panel = page.locator('.tab-body');
  await expect(panel).toContainText('BadSets: Opening Factor 1 must be 0');
  await expect(panel).toContainText('but no AirflowNetwork:MultiZone:Zone');
  await expect(panel).toContainText('EMS sets the opening factor of Win:East');
});

test('wind: Cp of the external nodes and site wind profile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'House with AirflowNetwork');
  await page.getByRole('tab', { name: 'Ventilation' }).click();
  await page.getByRole('tab', { name: 'Wind', exact: true }).click();
  await expect(page.locator('table.wind-nodes tbody tr')).toHaveCount(4);
  await page.getByRole('button', { name: 'SFacade', exact: true }).click();
  await expect(page.locator('.wind .notice.warn')).toContainText('EastRoof faces 90°');
  await expect(page.locator('.wind canvas')).toHaveCount(2);
  await expect(page.locator('.wind')).toContainText('Terrain Suburbs');
  expect(errors).toEqual([]);
});

test('network: zones, outdoor nodes and their connections', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'House with AirflowNetwork');
  await page.getByRole('tab', { name: 'Ventilation' }).click();
  await page.getByRole('tab', { name: 'Network', exact: true }).click();
  const panel = page.locator('.network');
  await expect(panel.locator('canvas')).toBeVisible();
  await expect(panel).toContainText('3 zones, 3 outdoor nodes and 6 connections');
  await expect(panel.locator('.notice.warn')).toContainText('External node EFacade');
  await expect(panel.locator('table.network-links tbody tr')).toHaveCount(6);
  // A surface of the table opens its AirflowNetwork card.
  await panel.getByRole('button', { name: 'Living:West', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Airflow network' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.afn-card')).toContainText('Living:West');
  expect(errors).toEqual([]);
});
