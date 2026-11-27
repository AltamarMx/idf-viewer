/**
 * Window inventory (L1) and AirflowNetwork roles (L2).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpolateCd } from '../src/core/airflow/afn';
import type { WindowRow } from '../src/core/openings/windows';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const loader = diskSchemaLoader();
const open = (path: string) => openFile({ name: path, buffer: fileBuffer(path) }, loader);
const byName = (rows: WindowRow[]) => new Map(rows.map((r) => [r.name, r]));

describe('interpolateCd', () => {
  const sets = [
    { openingFactor: 0, cd: 0.4, widthFactor: 0, heightFactor: 1, startHeightFactor: 0 },
    { openingFactor: 1, cd: 0.7, widthFactor: 1, heightFactor: 1, startHeightFactor: 0 },
    { openingFactor: 0.5, cd: 0.5, widthFactor: 0.5, heightFactor: 1, startHeightFactor: 0 },
  ];
  it('interpolates linearly between the sets, in opening factor order', () => {
    expect(interpolateCd(sets, 0.25)).toBeCloseTo(0.45);
    expect(interpolateCd(sets, 0.8)).toBeCloseTo(0.62);
    expect(interpolateCd(sets, 1)).toBeCloseTo(0.7);
    expect(interpolateCd(sets, 0)).toBeCloseTo(0.4);
  });
});

describe('Windows.idf (26.2)', () => {
  const ready = open('tests/fixtures/windows/Windows.idf').then((session) => {
    const inventory = session.windows();
    return { session, inventory, rows: byName(inventory.rows) };
  });

  it('lists every window and door with its kind and facing', async () => {
    const { inventory } = await ready;
    expect(inventory.rows.map((r) => [r.name, r.kind, r.facing]).sort()).toEqual(
      [
        ['Door:West', 'door', 'West'],
        ['GlassDoor:North', 'glassdoor', 'North'],
        ['Skylight', 'window', 'Roof'],
        ['Win:East', 'window', 'East'],
        ['Win:South', 'window', 'South'],
        ['Win:West', 'window', 'West'],
      ].sort(),
    );
  });

  it('reads size, sill, head, frame and multipliers', async () => {
    const { rows } = await ready;
    const south = rows.get('Win:South') as WindowRow;
    expect(south.width).toBeCloseTo(4);
    expect(south.height).toBeCloseTo(1.5);
    expect(south.sill).toBeCloseTo(1);
    expect(south.head).toBeCloseTo(2.5);
    expect(south.area).toBeCloseTo(6);
    expect(south.frameArea).toBeCloseTo(4.1 * 1.6 - 6);
    expect(south.frame).toBe('FRAME 5CM');
    expect(south.base).toBe('Zn001:Wall001');

    const east = rows.get('Win:East') as WindowRow;
    expect([east.width, east.height, east.sill, east.head]).toEqual([
      expect.closeTo(3),
      expect.closeTo(1.5),
      expect.closeTo(1),
      expect.closeTo(2.5),
    ]);

    // EnergyPlus ignores the frame of a simplified Window (checked with 26.2).
    const west = rows.get('Win:West') as WindowRow;
    expect(west.multiplier).toBe(3);
    expect(west.frame).toBe('FRAME 5CM');
    expect(west.frameIgnored).toBe(true);
    expect(west.frameArea).toBe(0);
    expect(west.totalArea).toBeCloseTo(1 * 1 * 3);

    const door = rows.get('GlassDoor:North') as WindowRow;
    expect(door.sill).toBeCloseTo(0);
    expect(door.head).toBeCloseTo(2.2);

    const sky = rows.get('Skylight') as WindowRow;
    expect(sky.area).toBeCloseTo(9);
    expect(sky.sill).toBeUndefined();
  });

  it('reads simple glazing and the shading control that lists the window', async () => {
    const { rows } = await ready;
    const south = rows.get('Win:South') as WindowRow;
    expect(south.glazing).toMatchObject({ name: 'SIMPLE LOW-E', u: 1.8, shgc: 0.35, vt: 0.62 });
    expect(south.shading.map((c) => [c.name, c.shadingType, c.controlType])).toEqual([
      ['SHADE CONTROL', 'InteriorShade', 'OnIfHighSolarOnWindow'],
    ]);
    expect(rows.get('Win:West')?.shading.map((c) => c.name)).toEqual(['SHADE CONTROL']);
    expect(rows.get('Win:East')?.shading).toEqual([]);
    expect(rows.get('Win:West')?.glazing).toMatchObject({ u: 5.7, shgc: 0.8, vt: undefined });
    expect(rows.get('Door:West')?.glazing).toBeUndefined();
  });

  it('links each opening to its AirflowNetwork component', async () => {
    const { session, inventory, rows } = await ready;
    expect(inventory.afn).toEqual({
      present: true,
      active: true,
      control: 'MultizoneWithoutDistribution',
    });
    const afn = (name: string) => {
      const link = rows.get(name)?.afn;
      return link && [link.type, link.role, link.factor, link.cd, link.controlMode];
    };
    expect(afn('Win:South')).toEqual(['simpleopening', 'operable', 0.5, 0.65, 'Constant']);
    // ZoneLevel (the default) takes the zone's mode.
    expect(afn('Win:East')).toEqual([
      'detailedopening',
      'operable',
      0.8,
      expect.closeTo(0.62),
      'NoVent',
    ]);
    expect(afn('GlassDoor:North')).toEqual([
      'detailedopening',
      'operable',
      0.25,
      expect.closeTo(0.45),
      'Constant',
    ]);
    expect(afn('Door:West')).toEqual(['ela', 'leakage', 1, 1, 'NoVent']);
    // No operable opening is allowed on an exterior skylight: it only leaks.
    expect(afn('Skylight')).toEqual(['ela', 'leakage', 0.4, 1, 'Constant']);
    expect(afn('Win:West')).toBeUndefined();
    expect(session.afn.surfaces.get('zn001:wall001')?.type).toBe('crack');
  });

  it('passes the AFN role to the 3D view', async () => {
    const { session } = await ready;
    const view = session.geometryView();
    expect(view.afn).toEqual({ present: true, active: true });
    const roles = new Map(view.surfaces.map((s) => [s.name, s.afn?.role]));
    expect(roles.get('Win:South')).toBe('operable');
    expect(roles.get('Zn001:Wall001')).toBe('leakage');
    expect(roles.get('Win:West')).toBeUndefined();
  });
});

describe('Windows-8.9.idf', () => {
  const ready = open('tests/fixtures/windows/Windows-8.9.idf').then((session) => ({
    session,
    rows: byName(session.windows().rows),
  }));

  it('reads the shading control named on the window (before 9.0)', async () => {
    const { rows } = await ready;
    for (const name of ['Win:South', 'Win:East']) {
      expect(rows.get(name)?.shading.map((c) => [c.name, c.shadingType])).toEqual([
        ['SHADE CONTROL', 'InteriorShade'],
      ]);
      expect(rows.get(name)?.glazing?.u).toBe(1.8);
    }
    expect(rows.get('Win:East')?.multiplier).toBe(2);
    expect(rows.get('Win:East')?.facing).toBe('East');
  });
});

describe('AirflowNetwork_MultiZone_SmallOffice', () => {
  const ready = open('examples/AirflowNetwork_MultiZone_SmallOffice.idf').then((session) => ({
    session,
    rows: byName(session.windows().rows),
  }));

  it('resolves ZoneLevel control and the other side of interzone doors', async () => {
    const { session, rows } = await ready;
    const win = rows.get('Zn001:Wall001:Win001')?.afn;
    expect(win).toMatchObject({ type: 'detailedopening', factor: 0.5, controlMode: 'Temperature' });
    expect(win?.cd).toBeCloseTo(0.55);
    // Only one side of the interzone door is listed; the other side shares it.
    expect(rows.get('Zn001:Wall003:Door001')?.afn).toMatchObject({ type: 'simpleopening' });
    expect(rows.get('Zn003:Wall004:Door001')?.afn).toMatchObject({
      type: 'simpleopening',
      viaPartner: 'Zn001:Wall003:Door001',
    });
    expect(session.afn.surfaces.get('zn003:wall003')?.type).toBe('exhaustfan');
    expect(session.afn.surfaces.get('zn003:wall001')?.type).toBe('specifiedflow');
    expect(session.afn.surfaces.get('zn001:wall001')?.type).toBe('ela');
  });
});

describe('window areas match the EnergyPlus window-wall ratio table', () => {
  const columns = {
    North: 'North (315 to 45 deg)',
    East: 'East (45 to 135 deg)',
    South: 'South (135 to 225 deg)',
    West: 'West (225 to 315 deg)',
  } as const;
  const stems = readdirSync(resolve(ROOT, 'examples'))
    .filter((f) => f.endsWith('.idf'))
    .map((f) => f.replace(/\.idf$/, ''))
    // Examples without EnergyPlus references yet (make_oracles.py) are skipped.
    .filter((stem) => existsSync(resolve(ROOT, `tests/oracles/${stem}.json`)));

  it.each(stems)('%s', async (stem) => {
    const oracle = JSON.parse(readFileSync(resolve(ROOT, `tests/oracles/${stem}.json`), 'utf8'));
    const table = oracle.building.windowWallRatio['Window Opening Area'];
    const session = await open(`examples/${stem}.idf`);
    const walls = new Map(
      session.geometry.surfaces.filter((s) => s.kind === 'wall').map((s) => [s.name, s]),
    );
    const sums: Record<string, number> = { North: 0, East: 0, South: 0, West: 0 };
    for (const r of session.windows().rows) {
      const wall = r.base ? walls.get(r.base) : undefined;
      if ((r.kind === 'window' || r.kind === 'glassdoor') && wall?.boundary === 'Outdoors')
        sums[r.facing] = (sums[r.facing] ?? 0) + r.totalArea;
    }
    for (const [facing, column] of Object.entries(columns)) {
      expect(sums[facing], `${facing}`).toBeCloseTo(table[column], 1);
    }
  });
});

/**
 * EnergyPlus' own "Exterior Fenestration" table, when the oracle has it
 * (tools/make_oracles.py writes it since phase 2b).
 */
describe('inventory matches the EnergyPlus fenestration table', () => {
  const cases = [
    ...readdirSync(resolve(ROOT, 'examples'))
      .filter((f) => f.endsWith('.idf'))
      .map((f) => `examples/${f}`),
    'tests/fixtures/windows/Windows.idf',
  ]
    .map((idf) => {
      const stem = idf.replace(/^.*\//, '').replace(/\.idf$/, '');
      const path = resolve(ROOT, `tests/oracles/${stem}.json`);
      const oracle = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
      return [stem, idf, oracle?.fenestration] as const;
    })
    .filter(([, , table]) => table && Object.keys(table).length > 0);

  it.skipIf(cases.length === 0)('has oracles with the fenestration table', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s', async (_stem, idf, table) => {
    const session = await open(idf);
    const rows = new Map(session.windows().rows.map((r) => [r.name.toUpperCase(), r]));
    const problems: string[] = [];
    for (const [name, ref] of Object.entries(table as Record<string, Record<string, unknown>>)) {
      const row = rows.get(name.toUpperCase());
      if (!row) {
        problems.push(`${name}: not in the inventory`);
        continue;
      }
      const same = (a: unknown, b: unknown) =>
        String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();
      if (!same(ref['Parent Surface'], row.base)) problems.push(`${name}: parent surface`);
      if (!same(ref.Construction, row.construction)) problems.push(`${name}: construction`);
      const total = ref['Area of Multiplied Openings'];
      if (
        typeof total === 'number' &&
        Math.abs(total - row.totalArea) > Math.max(0.01, total * 0.005)
      )
        problems.push(`${name}: area ${row.totalArea.toFixed(3)} vs ${total}`);
      const u = ref['Glass U-Factor'];
      if (
        row.glazing?.u !== undefined &&
        typeof u === 'number' &&
        Math.abs(u - row.glazing.u) > 0.02 * u
      )
        problems.push(`${name}: U ${row.glazing.u} vs ${u}`);
      const shgc = ref['Glass SHGC'];
      if (
        row.glazing?.shgc !== undefined &&
        typeof shgc === 'number' &&
        Math.abs(shgc - row.glazing.shgc) > 0.01
      )
        problems.push(`${name}: SHGC ${row.glazing.shgc} vs ${shgc}`);
    }
    expect(problems.slice(0, 15).join('\n'), `${problems.length} differences`).toBe('');
  });
});
