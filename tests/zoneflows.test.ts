/**
 * Infiltration and ventilation without AirflowNetwork (L7, L8).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coefficientModel } from '../src/core/airflow/zoneflows';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const loader = diskSchemaLoader();
const open = (path: string) => openFile({ name: path, buffer: fileBuffer(path) }, loader);

describe('coefficient models', () => {
  it('recognizes constant, DOE-2 and BLAST coefficients', () => {
    expect(coefficientModel(1, 0, 0, 0)).toBe('constant');
    expect(coefficientModel(0, 0, 0.2237, 0)).toBe('doe2');
    expect(coefficientModel(0.606, 0.03636, 0.1177, 0)).toBe('blast');
    expect(coefficientModel(0.5, 0, 0.1, 0)).toBe('custom');
  });
});

describe('ASHRAE901_ApartmentHighRise_STD2019_Denver', () => {
  const ready = open('examples/ASHRAE901_ApartmentHighRise_STD2019_Denver.idf');

  it('computes Flow/ExteriorArea infiltration with the exterior surface area', async () => {
    const flows = (await ready).zoneFlows();
    const row = flows.rows.find((r) => r.name === 'G SW Apartment_Infiltration');
    const zone = flows.zones.find((z) => z.name === 'G SW Apartment');
    expect(row).toMatchObject({
      method: 'Flow/ExteriorArea',
      perExterior: expect.closeTo(0.00056896, 8),
    });
    expect(row?.design).toBeCloseTo(0.00056896 * (zone?.exteriorArea ?? 0), 8);
    expect(row?.ach).toBeCloseTo(((row?.design ?? 0) * 3600) / (zone?.volume ?? 1), 6);
    expect(row?.coefficients?.model).toBe('doe2');
    expect(flows.warnings).toEqual([]);
  });

  it('lists the wind and stack openings and their area per zone', async () => {
    const flows = (await ready).zoneFlows();
    const windstack = flows.rows.filter((r) => r.kind === 'windstack');
    expect(windstack.length).toBe(79);
    const zone = flows.zones.find((z) => z.name === 'G SW Apartment');
    expect(zone?.openArea).toBeGreaterThan(0);
    expect(zone?.windowArea).toBeGreaterThan(zone?.openArea ?? 0);
  });
});

describe('AirflowNetwork_MultiZone_House', () => {
  it('shows the AFN leakage of each zone', async () => {
    const flows = (await open('examples/AirflowNetwork_MultiZone_House.idf')).zoneFlows();
    expect(flows.rows).toEqual([]);
    const living = flows.zones.find((z) => z.name === 'LIVING ZONE');
    expect(living?.afn.inNetwork).toBe(true);
    expect(living?.afn.leakage.map((l) => l.surface)).toEqual([
      'Living:West',
      'Living:Interior',
      'Living:Ceiling',
    ]);
  });
});

describe('Flows.idf (8.x and 26.2 syntax)', () => {
  it.each(['tests/fixtures/ventilation/Flows.idf', 'tests/fixtures/ventilation/Flows-8.9.idf'])(
    '%s',
    async (path) => {
      const flows = (await open(path)).zoneFlows();
      const row = (name: string) => flows.rows.find((r) => r.name === name);
      const zone = flows.zones.find((z) => z.name === 'ZONE ONE');
      if (!zone) throw new Error('no zone');
      // 15.24 × 15.24 × 4.572 m
      expect(zone.volume).toBeCloseTo(1061.88, 1);
      expect(row('Infil ACH')?.design).toBeCloseTo((0.5 * zone.volume) / 3600, 6);
      expect(row('Infil ACH')?.coefficients?.model).toBe('blast');
      expect(row('Infil Area')?.design).toBeCloseTo(0.0003 * zone.floorArea, 8);
      expect(row('Infil ExtWall')?.design).toBeCloseTo(0.0002 * zone.exteriorWallArea, 8);
      expect(row('Infil ELA')?.design).toBeUndefined();
      expect(row('Infil ELA')?.note).toContain('Sherman');
      expect(row('Vent Natural')).toMatchObject({ kind: 'ventilation', design: 0.2 });
      expect(row('Vent WindStack')).toMatchObject({ kind: 'windstack' });
      expect(zone.openArea).toBeCloseTo(1.5);
      expect(zone.infiltration).toMatchObject({ objects: 4, weatherOnly: 1 });
      // Flow/ExteriorWallArea: the four walls; Flow/ExteriorArea would add the roof.
      expect(zone.exteriorWallArea).toBeCloseTo(4 * 15.24 * 4.572, 2);
      expect(zone.exteriorArea).toBeCloseTo(4 * 15.24 * 4.572 + 15.24 * 15.24, 2);
    },
  );
});

/** EnergyPlus' "Airflow Stats Nominal" tables, when the oracle has them. */
describe('design flows match EnergyPlus', () => {
  const cases = readdirSync(resolve(ROOT, 'examples'))
    .filter((f) => f.endsWith('.idf'))
    .map((f) => `examples/${f}`)
    .concat(['tests/fixtures/ventilation/Flows.idf'])
    .map((idf) => {
      const stem = idf.replace(/^.*\//, '').replace(/\.idf$/, '');
      const path = resolve(ROOT, `tests/oracles/${stem}.json`);
      const oracle = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
      return [
        stem,
        idf,
        oracle?.airflow as Record<string, Record<string, unknown>[]> | undefined,
      ] as const;
    })
    .filter(([, , airflow]) => airflow && Object.keys(airflow).length > 0);

  it.skipIf(cases.length === 0)('has oracles with airflow tables', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s', async (_stem, idf, airflow) => {
    const flows = (await open(idf)).zoneFlows();
    const problems: string[] = [];
    // EnergyPlus splits an object of a zone with several spaces into one instance
    // per space ("<space> <object>"), sharing the zone flow by floor area: add
    // them up per object and zone.
    type Ref = Record<string, unknown>;
    const totals = new Map<
      (typeof flows.rows)[number],
      { name: string; design: number; refs: Ref[] }
    >();
    for (const [section, rows] of Object.entries(airflow ?? {})) {
      for (const ref of rows) {
        const key = (pattern: RegExp) => Object.keys(ref).find((k) => pattern.test(k));
        const name = String(ref.Name ?? '').toUpperCase();
        const zone = String(ref[key(/^Zone Name$/) ?? ''] ?? '').toUpperCase();
        const design = ref[key(/Design Volume Flow Rate/) ?? ''];
        if (typeof design !== 'number') continue;
        const row = flows.rows.find(
          (r) =>
            r.zone.toUpperCase() === zone &&
            (r.name.toUpperCase() === name || name.endsWith(` ${r.name.toUpperCase()}`)),
        );
        if (!row) {
          problems.push(`${section}: ${name} in ${zone} not found`);
          continue;
        }
        const total = totals.get(row) ?? { name, design: 0, refs: [] };
        total.design += design;
        total.refs.push(ref);
        totals.set(row, total);
      }
    }
    const near = (a: number | undefined, b: number) =>
      a !== undefined && Math.abs(a - b) <= Math.max(1e-6, 0.005 * Math.abs(b));
    for (const [row, { name, design, refs }] of totals) {
      // Normalized values and coefficients of objects that are not split by space.
      const ref = refs.length === 1 ? (refs[0] as Ref) : undefined;
      if (ref && design > 0) {
        const value = (pattern: RegExp) => {
          const k = Object.keys(ref).find((x) => pattern.test(x));
          return k && typeof ref[k] === 'number' ? (ref[k] as number) : undefined;
        };
        const checks: [string, number | undefined, number | undefined][] = [
          ['ACH', row.ach, value(/^ACH/)],
          ['per floor area', row.perFloor, value(/Flow Rate\/Floor Area/)],
          ['per exterior area', row.perExterior, value(/Flow Rate\/Exterior Surface Area/)],
          ['A', row.coefficients?.a, value(/^Equation A/)],
          ['B', row.coefficients?.b, value(/^Equation B/)],
          ['C', row.coefficients?.c, value(/^Equation C/)],
          ['D', row.coefficients?.d, value(/^Equation D/)],
        ];
        for (const [label, ours, theirs] of checks)
          if (theirs !== undefined && !near(ours, theirs))
            problems.push(`${name} in ${row.zone}: ${label} ${ours} vs ${theirs}`);
      }
      // Effective leakage area and wind and stack open area depend on the
      // weather: EnergyPlus reports 0 and the viewer shows the formula.
      if (row.design === undefined && design === 0) continue;
      if (
        row.design === undefined ||
        Math.abs(row.design - design) > Math.max(1e-6, 0.005 * design)
      )
        problems.push(`${name} in ${row.zone}: design ${row.design} vs ${design}`);
    }
    expect(problems.slice(0, 15).join('\n'), `${problems.length} differences`).toBe('');
  });
});
