import { readFileSync } from 'node:fs';
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
  // 4 broken references (Refrigeration:Case curves) and 26 unused objects (notes).
  await expect(page.locator('table.problems tr')).toHaveCount(30);
  await page.getByLabel('Category').selectOption('Reference');
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

test('constructions: layers from outside to inside, usage and 3D', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'Five zones with spaces');
  await page.getByRole('tab', { name: 'Constructions' }).click();
  const list = page.locator('.constructions-list');
  await list.getByRole('button', { name: 'WALL-1', exact: true }).click();
  const detail = page.locator('.construction-detail');
  await expect(detail.locator('.layer-section rect.layer-rect')).toHaveCount(4);
  await expect(detail.locator('.layer-card')).toHaveCount(4);
  await expect(detail).toContainText('10 surfaces in 5 zones');
  // A layer opens its material in the inspector.
  await detail.getByRole('button', { name: 'IN02', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('IN02');
  await page.getByRole('tab', { name: 'Constructions' }).click();
  await list.getByRole('button', { name: 'WALL-1', exact: true }).click();
  await detail.getByRole('button', { name: 'Show in 3D' }).click();
  await expect(page.locator('.viewer canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('problems: field values against the IDD and unused objects', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/validation/Validation.idf');
  await page.getByRole('tab', { name: /Problems/ }).click();
  const panel = page.locator('.tab-body');
  await expect(panel).toContainText('Conductivity is required and blank');
  await expect(panel).toContainText('Only one Timestep is allowed');
  await page.getByLabel('Category').selectOption('Unused');
  await expect(panel.locator('table.problems tr')).toHaveCount(6);
  await panel.getByRole('button', { name: /UNUSED CURVE/ }).click();
  await expect(page.locator('.inspector')).toContainText('Curve:Linear');
  expect(errors).toEqual([]);
});

test('text view follows the inspector and a click opens an object', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'One zone, uncontrolled');
  await page.getByRole('tab', { name: 'Text' }).click();
  const editor = page.locator('.text-editor .cm-editor');
  await expect(editor).toContainText('1ZoneUncontrolled.idf');
  // Choosing an object scrolls to it and highlights its lines.
  await page.keyboard.press('ControlOrMeta+K');
  await page.locator('.search-dialog input').fill('zone one');
  await expect(page.locator('.search-results')).toContainText('ZONE ONE');
  await page.keyboard.press('Enter');
  await expect(editor.locator('.cm-selected-object').first()).toContainText('Zone,');
  // A click on a line of another object opens it in the inspector.
  await editor.locator('.cm-line', { hasText: 'Zn001:Wall001,' }).first().click();
  await expect(page.locator('.inspector-head h2')).toHaveText('Zn001:Wall001');
  await expect(editor.locator('.cm-selected-object').first()).toContainText(
    'BuildingSurface:Detailed',
  );
  expect(errors).toEqual([]);
});

test('summary: site with design days and requested outputs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'High-rise apartment building');
  await page.getByRole('tab', { name: 'Site and design days' }).click();
  await expect(page.locator('.site-map')).toBeVisible();
  await expect(page.locator('table.design-days tbody tr')).toHaveCount(2);
  await expect(page.locator('.site')).toContainText('2nd Sunday in March');
  await page.getByRole('tab', { name: 'Outputs' }).click();
  await expect(page.locator('.outputs')).toContainText('AllSummaryAndMonthly');
  await expect(page.locator('.outputs')).toContainText('Monthly tables (9)');
  expect(errors).toEqual([]);
});

test('3D layers: surface types, cut, separate floors and daylighting points', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'Small office with AirflowNetwork');
  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.locator('.viewer canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Layers and cuts' }).click();
  const panel = page.locator('.layers-panel');
  await expect(panel).toContainText('Daylighting points (1)');
  await expect(panel.locator('.layers-list.zones label')).toHaveCount(4);
  // Only the surface types in the file are listed: the small office has no shading.
  await expect(panel.getByRole('checkbox', { name: 'Shading' })).toHaveCount(0);
  await panel.getByRole('checkbox', { name: 'Windows' }).uncheck();
  await panel.getByRole('checkbox', { name: 'Roofs' }).uncheck();
  await panel.locator('.layers-slider', { hasText: 'Cut at' }).getByRole('checkbox').check();
  await panel.getByLabel('Separate').selectOption('floors');
  await panel.getByLabel('Separation').fill('4');
  await expect(panel).toContainText('+4 m');
  await panel.getByRole('button', { name: 'Reset layers' }).click();
  await expect(panel.getByRole('checkbox', { name: 'Windows' })).toBeChecked();
  await expect(panel.getByRole('checkbox', { name: 'Roofs' })).toBeChecked();
  expect(errors).toEqual([]);
});

test('3D exploded zones with interzone pair lines', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openExample(page, 'Five zones with spaces');
  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.locator('.viewer canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Layers and cuts' }).click();
  const panel = page.locator('.layers-panel');
  await panel.getByLabel('Separation').fill('0.6');
  await expect(panel).toContainText('60 %');
  await panel.getByRole('checkbox', { name: /Interzone pairs/ }).check();
  await expect(panel).toContainText('The other side does not exist: 0');
  expect(errors).toEqual([]);
});

test('geometry problems in the problems panel and in the 3D view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.locator('input[type=file]').setInputFiles('tests/fixtures/geometry/Defects.idf');
  await page.getByRole('tab', { name: /Problems/ }).click();
  await page.getByLabel('Category').selectOption('Geometry');
  await expect(page.locator('table.problems')).toContainText(
    'Upside Down Roof (roof) is upside down',
  );
  await page.getByRole('button', { name: /Not Planar South is not planar/ }).click();
  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.locator('.viewer canvas')).toBeVisible();
  await expect(page.locator('.surface-info')).toContainText('12.5 mm out of its plane');
  await page.getByLabel('Color by').selectOption('issues');
  await expect(page.locator('.legend')).toContainText('Error');
  await page.getByRole('button', { name: 'Layers and cuts' }).click();
  await page
    .locator('.layers-panel')
    .getByRole('checkbox', { name: /Normals/ })
    .check();
  expect(errors).toEqual([]);
});

test('?url= opens a file from GitHub through its raw address', async ({ page }) => {
  const idf = readFileSync('examples/1ZoneUncontrolled.idf');
  const requested: string[] = [];
  await page.route('https://raw.githubusercontent.com/**', (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      body: idf,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' },
    });
  });
  await page.goto('./?url=https://github.com/someone/models/blob/main/One%20zone.idf');
  await expect(page.locator('.file-meta')).toContainText('One zone.idf');
  await expect(page.locator('.file-meta')).toContainText('v26.2');
  expect(requested).toEqual([
    'https://raw.githubusercontent.com/someone/models/main/One%20zone.idf',
  ]);

  // Back to the start page: the address no longer names a file.
  await page.getByRole('button', { name: 'IDF Viewer' }).click();
  await expect(page).toHaveURL(/\/idf-viewer\/$/);
});

test('open from a URL: a failed download gives a clear error', async ({ page }) => {
  // Playwright does not apply CORS to the responses it fakes; for the page, a server that does
  // not allow other sites and a failed connection are the same error.
  await page.route('https://models.example.org/**', (route) => route.abort('failed'));
  await page.goto('./');
  await page.getByText('Or open from a URL').click();
  await page.getByLabel('Address of the IDF file').fill('https://models.example.org/a.idf');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.notice.error')).toContainText('Could not open a.idf');
  await expect(page.locator('.notice.error')).toContainText('CORS');
  await expect(page).toHaveURL(/\?url=https:\/\/models\.example\.org\/a\.idf$/);

  // Reloading tries again and keeps the address in the field.
  await page.reload();
  await expect(page.locator('.notice.error')).toContainText('CORS');
  await expect(page.getByLabel('Address of the IDF file')).toHaveValue(
    'https://models.example.org/a.idf',
  );
});

test('an example gets a link that reopens it; a local file clears it', async ({ page }) => {
  await openExample(page, 'One zone, uncontrolled');
  await expect(page).toHaveURL(/\?url=examples\/1ZoneUncontrolled\.idf$/);
  await page.reload();
  await expect(page.locator('.file-meta')).toContainText('1ZoneUncontrolled.idf');

  await page.locator('input[type=file]').setInputFiles('tests/fixtures/1ZoneUncontrolled-8.2.idf');
  await expect(page.locator('.file-meta')).toContainText('v8.2');
  await expect(page).toHaveURL(/\/idf-viewer\/$/);
});
