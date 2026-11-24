/**
 * Exploded view and interzone pair lines of the 3D view (C7).
 */
import { describe, expect, it } from 'vitest';
import { openFile } from '../src/core/session';
import {
  explodeOffsets,
  pairLines,
  surfaceCenters,
  zoneCenters,
} from '../src/features/viewer3d/explode';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();

const wall = (name: string, zone: string, other: string, x: number) =>
  `BuildingSurface:Detailed,${name},Wall,,${zone},,Surface,${other},NoSun,NoWind,,4,` +
  `${x},0,3,${x},0,0,${x + 1},0,0,${x + 1},0,3;`;

/** W1–W2 name each other; W3 names W4, which names W2; W5 names nothing; W6 names itself. */
const PAIRS = [
  'Version,26.2;',
  'GlobalGeometryRules,UpperLeftCorner,Counterclockwise,Relative;',
  'Zone,A;',
  'Zone,B;',
  wall('W1', 'A', 'W2', 0),
  wall('W2', 'B', 'W1', 0),
  wall('W3', 'A', 'W4', 2),
  wall('W4', 'B', 'W2', 2),
  wall('W5', 'A', 'NOPE', 4),
  wall('W6', 'A', 'W6', 6),
].join('\n');

describe('interzone pair lines', () => {
  it('tells mutual, one-way and missing pairs apart', async () => {
    const view = (await openFile({ name: 'pairs.idf', text: PAIRS }, loader)).geometryView();
    const name = (i?: number) => (i === undefined ? '—' : view.surfaces[i]?.name);
    expect(pairLines(view.surfaces).map((p) => [name(p.from), name(p.to), p.status])).toEqual([
      ['W1', 'W2', 'ok'],
      ['W3', 'W4', 'one-way'],
      ['W4', 'W2', 'one-way'],
      ['W5', '—', 'missing'],
    ]);
  });

  it('finds every pair of the five-zone example closed', async () => {
    const path = 'examples/5ZoneAirCooledWithSpaces.idf';
    const view = (await openFile({ name: path, buffer: fileBuffer(path) }, loader)).geometryView();
    const lines = pairLines(view.surfaces);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.every((p) => p.status === 'ok')).toBe(true);
  });
});

describe('exploded view', () => {
  it('pulls the zones apart so both faces of a shared wall show', async () => {
    const path = 'examples/5ZoneAirCooledWithSpaces.idf';
    const view = (await openFile({ name: path, buffer: fileBuffer(path) }, loader)).geometryView();
    const surfaces = view.surfaces;
    const centers = surfaceCenters(surfaces);
    const zones = zoneCenters(surfaces, centers);
    const at = (name: string, offsets: [number, number, number][]) => {
      const i = surfaces.findIndex((s) => s.name === name);
      const c = centers[i] as number[];
      const o = offsets[i] as number[];
      return c.map((v, k) => v + (o[k] as number));
    };
    const gap = (offsets: [number, number, number][]) => {
      const a = at('SB12', offsets);
      const b = at('SB21', offsets);
      return Math.hypot(
        (a[0] ?? 0) - (b[0] ?? 0),
        (a[1] ?? 0) - (b[1] ?? 0),
        (a[2] ?? 0) - (b[2] ?? 0),
      );
    };
    const still = explodeOffsets(surfaces, 'zones', 0, zones, []);
    const apart = explodeOffsets(surfaces, 'zones', 0.5, zones, []);
    // Together the two faces of the wall between zones 1 and 2 coincide.
    expect(gap(still)).toBeLessThan(0.01);
    expect(gap(apart)).toBeGreaterThan(1);
    // A window moves with its wall.
    const wf = surfaces.findIndex((s) => s.name === 'WF-1');
    const front = surfaces.findIndex((s) => s.name === 'FRONT-1');
    expect(apart[wf]).toEqual(apart[front]);
  });

  it('lifts each floor level by its order when separating floors', async () => {
    const path = 'examples/AirflowNetwork_MultiZone_SmallOffice.idf';
    const view = (await openFile({ name: path, buffer: fileBuffer(path) }, loader)).geometryView();
    const offsets = explodeOffsets(view.surfaces, 'floors', 2, new Map(), [0, 3]);
    const of = (zone: string) => offsets[view.surfaces.findIndex((s) => s.zone === zone)];
    expect(of('West Zone')).toEqual([0, 0, 0]);
    expect(of('ATTIC ZONE')).toEqual([0, 0, 2]);
  });
});
