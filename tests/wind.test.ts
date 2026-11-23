/**
 * Wind pressure coefficients of the external nodes and site wind profile (L9).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { periodicLinear, speedRatio, type WindNode } from '../src/core/airflow/wind';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();
const open = (path: string) => openFile({ name: path, buffer: fileBuffer(path) }, loader);
const at = (node: WindNode | undefined, angle: number) =>
  node?.cp.curve.find(([a]) => a === angle)?.[1];
const byName = (nodes: WindNode[], name: string) => nodes.find((n) => n.name === name);

describe('periodicLinear', () => {
  it('interpolates between directions and from the last one back to 360°', () => {
    const pts: [number, number][] = [
      [0, 0.6],
      [90, -0.6],
      [180, -0.4],
      [270, -0.6],
    ];
    expect(periodicLinear(pts, 45)).toBeCloseTo(0);
    expect(periodicLinear(pts, 315)).toBeCloseTo(0);
    expect(periodicLinear(pts, 360)).toBeCloseTo(0.6);
  });
});

describe('AirflowNetwork_MultiZone_House', () => {
  const ready = open('examples/AirflowNetwork_MultiZone_House.idf');

  it('reads the Cp of each facade and the surfaces that use it', async () => {
    const w = (await ready).wind();
    expect(w.cpInput).toBe(true);
    expect(w.heightSelection).toBe('ExternalNode');
    expect(w.nodes.map((n) => n.name)).toEqual(['NFacade', 'EFacade', 'SFacade', 'WFacade']);
    const north = byName(w.nodes, 'NFacade');
    expect(north?.cp.kind).toBe('values');
    expect(north?.cp.points).toHaveLength(12);
    expect(north?.cp.points[0]).toEqual([0, 0.6]);
    expect(at(north, 0)).toBeCloseTo(0.6);
    expect(at(north, 15)).toBeCloseTo(0.54);
    // After 330° the values go back to the one at 0°.
    expect(at(north, 345)).toBeCloseTo(0.54);
    expect(north?.surfaces.every((s) => s.facing === 'North')).toBe(true);
    expect(north?.surfaces.length).toBeGreaterThan(0);
  });

  it('flags a surface whose node has its highest Cp in another direction', async () => {
    const { nodes } = (await ready).wind();
    // In the example the east roof uses the south facade node.
    expect(byName(nodes, 'SFacade')?.warnings).toEqual([
      expect.stringMatching(
        /^EastRoof faces 90° \(a roof\), but this node's highest Cp is for wind from 180°/,
      ),
    ]);
    expect(byName(nodes, 'NFacade')?.warnings).toEqual([]);
    expect(byName(nodes, 'WFacade')?.warnings).toEqual([]);
  });

  it('uses the Suburbs profile and the default weather station', async () => {
    const { site, nodes } = (await ready).wind();
    expect(site.terrain).toBe('Suburbs');
    expect(site.exponent).toMatchObject({ value: 0.22, from: 'Terrain Suburbs' });
    expect(site.boundaryLayer.value).toBe(370);
    expect(site.station.height).toMatchObject({ value: 10, from: 'default' });
    // (270/10)^0.14 · (1.524/370)^0.22
    expect(site.stationFactor).toBeCloseTo(1.586, 3);
    expect(byName(nodes, 'NFacade')?.speedRatio).toBeCloseTo(1.586 * (1.524 / 370) ** 0.22, 3);
    expect(site.profile[0]).toEqual([0, 0]);
  });
});

describe('Wind fixture (26.2)', () => {
  const ready = open('tests/fixtures/ventilation/Wind.idf');

  it('applies Site:HeightVariation and Site:WeatherStation', async () => {
    const { site } = (await ready).wind();
    expect(site.exponent).toMatchObject({ value: 0.25, from: 'Site:HeightVariation' });
    // Not given in Site:HeightVariation: the terrain value stays.
    expect(site.boundaryLayer).toMatchObject({ value: 370, from: 'Terrain Suburbs' });
    expect(site.station.height).toMatchObject({ value: 12, from: 'Site:WeatherStation' });
    expect(site.stationFactor).toBeCloseTo((270 / 12) ** 0.14, 6);
    expect(speedRatio(site, 2)).toBeCloseTo((270 / 12) ** 0.14 * (2 / 370) ** 0.25, 6);
  });

  it('reads values, a symmetric lookup table and a curve', async () => {
    const { nodes } = (await ready).wind();
    const south = byName(nodes, 'SFacade');
    expect(south?.cp.kind).toBe('values');
    expect(south?.surfaces.map((s) => s.name).sort()).toEqual(['Win:South', 'Zn001:Wall001']);
    expect(at(south, 180)).toBeCloseTo(0.6);

    const east = byName(nodes, 'EFacade');
    expect(east).toMatchObject({ symmetric: true, angleType: 'Relative' });
    expect(east?.cp).toMatchObject({ kind: 'table', className: 'Table:Lookup' });
    expect(east?.cp.points).toEqual([
      [0, 0.6],
      [45, 0.3],
      [90, -0.56],
      [135, -0.5],
      [180, -0.37],
    ]);
    // Symmetric: 270° reads the value at 90°.
    expect(at(east, 270)).toBeCloseTo(-0.56);
    expect(at(east, 315)).toBeCloseTo(0.3);

    const north = byName(nodes, 'NFacade');
    expect(north?.cp.kind).toBe('curve');
    expect(at(north, 0)).toBeCloseTo(0.6);
    expect(at(north, 90)).toBeCloseTo(0.6 - 0.0133 * 90 + 0.0000317 * 90 ** 2);
    // Limited by Minimum Curve Output.
    expect(at(north, 180)).toBeCloseTo(-0.7);
    expect(at(north, 360)).toBeCloseTo(0.6);

    expect(byName(nodes, 'RoofNode')?.surfaces[0]?.facing).toBe('Roof');
    expect(nodes.flatMap((n) => n.warnings)).toEqual([]);
  });
});

describe('8.x syntax', () => {
  it('8.2: values named by the node, array on the simulation control', async () => {
    const { nodes, cpInput } = (await open('tests/fixtures/ventilation/Wind-8.2.idf')).wind();
    expect(cpInput).toBe(true);
    const south = byName(nodes, 'SFacade');
    expect(south).toMatchObject({ symmetric: false, angleType: 'Absolute' });
    expect(south?.cp.array?.name).toBe('Every 90 Degrees');
    expect(south?.cp.points).toHaveLength(4);
    expect(at(south, 135)).toBeCloseTo((-0.56 + 0.6) / 2);
  });

  it('8.9: Table:OneIndependentVariable, symmetric and relative', async () => {
    const { nodes } = (await open('tests/fixtures/ventilation/Wind-8.9.idf')).wind();
    const other = byName(nodes, 'OtherFacade');
    expect(other).toMatchObject({ symmetric: true, angleType: 'Relative' });
    expect(other?.cp).toMatchObject({ kind: 'table', className: 'Table:OneIndependentVariable' });
    expect(other?.cp.points).toEqual([
      [0, 0.6],
      [90, -0.56],
      [180, -0.37],
    ]);
    expect(at(other, 45)).toBeCloseTo(0.02);
    expect(at(other, 315)).toBeCloseTo(0.02);
  });
});

it('files without AirflowNetwork still get the site wind profile', async () => {
  const w = (await open('examples/1ZoneUncontrolled.idf')).wind();
  expect(w.afn).toBe(false);
  expect(w.nodes).toEqual([]);
  expect(w.site.profile.length).toBeGreaterThan(5);
});

/** The wind profile EnergyPlus reports in the .eio, when the oracle has it. */
describe('site wind profile matches EnergyPlus', () => {
  const ROOT = resolve(__dirname, '..');
  const cases = readdirSync(resolve(ROOT, 'examples'))
    .filter((f) => f.endsWith('.idf'))
    .map((f) => `examples/${f}`)
    .concat(['tests/fixtures/ventilation/Wind.idf'])
    .map((idf) => {
      const stem = idf.replace(/^.*\//, '').replace(/\.idf$/, '');
      const path = resolve(ROOT, `tests/oracles/${stem}.json`);
      const oracle = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
      return [
        stem,
        idf,
        oracle?.site as Record<string, Record<string, number>[]> | undefined,
      ] as const;
    })
    .filter(([, , site]) => site && Object.keys(site).length > 0);

  it.skipIf(cases.length === 0)('has oracles with the site wind profile', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s', async (_stem, idf, site) => {
    const { site: mine } = (await open(idf)).wind();
    const value = (section: string, pattern: RegExp) => {
      const row = site?.[section]?.[0] ?? {};
      const key = Object.keys(row).find((k) => pattern.test(k));
      return key === undefined ? undefined : row[key];
    };
    const atmosphere = 'Environment:Site Atmospheric Variation';
    const station = 'Environment:Weather Station';
    expect(mine.exponent.value).toBeCloseTo(
      value(atmosphere, /^Wind Speed Profile Exponent/) as number,
      3,
    );
    expect(mine.boundaryLayer.value).toBeCloseTo(
      value(atmosphere, /^Wind Speed Profile Boundary Layer Thickness/) as number,
      1,
    );
    expect(mine.station.height.value).toBeCloseTo(
      value(station, /^Wind Sensor Height/) as number,
      2,
    );
    const modifier = value(station, /^Wind Speed Modifier Coefficient/);
    if (modifier !== undefined) expect(mine.stationFactor).toBeCloseTo(modifier, 2);
  });
});
