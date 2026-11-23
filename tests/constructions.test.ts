/**
 * Constructions: layers as written in the IDF (E1) and where each one is used (E3).
 */
import { describe, expect, it } from 'vitest';
import type { ConstructionRow } from '../src/core/constructions/constructions';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();
const open = async (path: string) =>
  (await openFile({ name: path, buffer: fileBuffer(path) }, loader)).constructions();
const byName = (rows: ConstructionRow[], name: string) => {
  const row = rows.find((c) => c.name === name);
  if (!row) throw new Error(`no construction ${name}`);
  return row;
};
const layers = (c: ConstructionRow) =>
  c.layers.map((l) => [l.name, l.category, l.thickness ?? null]);
const field = (c: ConstructionRow['layers'][number], label: string) =>
  c.fields.find((f) => f.label === label);

describe('Constructions.idf', () => {
  const ready = open('tests/fixtures/constructions/Constructions.idf');

  it('lists the layers from outside to inside with their thickness', async () => {
    const wall = byName(await ready, 'BRICK WALL');
    expect(layers(wall)).toEqual([
      ['BRICK 100MM', 'opaque', 0.1],
      ['WALL AIR SPACE', 'airgap', null],
      ['GYPSUM 13MM', 'opaque', 0.0127],
    ]);
    expect(wall.thickness).toBeCloseTo(0.1127);
    expect(wall.glazed).toBe(false);
  });

  it('shows material properties as written, with IDD defaults for blank fields', async () => {
    const [brick, gap] = byName(await ready, 'BRICK WALL').layers;
    if (!brick || !gap) throw new Error('missing layers');
    expect(field(brick, 'Conductivity')).toMatchObject({ value: '0.89', units: 'W/m-K' });
    // The absorptances are not written: EnergyPlus uses 0.9, 0.7 and 0.7.
    expect(field(brick, 'Thermal Absorptance')).toMatchObject({ value: '0.9', defaulted: true });
    expect(field(brick, 'Solar Absorptance')).toMatchObject({ value: '0.7', defaulted: true });
    expect(field(gap, 'Thermal Resistance')).toMatchObject({ value: '0.18', units: 'm2-K/W' });
  });

  it('finds the internal heat source of a construction (22.1+)', async () => {
    const wall = byName(await ready, 'BRICK WALL');
    expect(wall.internalSource).toMatchObject({
      className: 'ConstructionProperty:InternalHeatSource',
      name: 'BRICK WALL SOURCE',
      afterLayer: 1,
    });
  });

  it('counts the surfaces and area of each construction', async () => {
    const rows = await ready;
    const wall = byName(rows, 'BRICK WALL');
    expect(wall.usage).toMatchObject({ surfaces: 1, zones: 1 });
    expect(wall.usage.list.map((s) => s.name)).toEqual(['Zn001:Wall001']);
    // 15.24 m × 4.572 m.
    expect(wall.usage.area).toBeCloseTo(69.68, 1);
    expect(byName(rows, 'R13WALL').usage.surfaces).toBe(3);
  });

  it('tells window constructions apart and finds their other users', async () => {
    const rows = await ready;
    const shaded = byName(rows, 'DOUBLE ARGON WITH SHADE');
    expect(layers(shaded)).toEqual([
      ['CLEAR 6MM', 'glazing', 0.006],
      ['ARGON 13MM', 'gas', 0.0127],
      ['CLEAR 6MM', 'glazing', 0.006],
      ['LIGHT SHADE', 'shading', 0.003],
    ]);
    expect(shaded.glazed).toBe(true);
    expect(shaded.usage.surfaces).toBe(0);
    expect(shaded.usedBy).toEqual([
      expect.objectContaining({
        className: 'WindowShadingControl',
        name: 'SHADE CONTROL',
        fieldName: 'Construction with Shading Name',
      }),
    ]);
    // Neither surfaces nor other objects use it.
    expect(byName(rows, 'DOUBLE ARGON')).toMatchObject({
      usage: expect.objectContaining({ surfaces: 0 }),
      usedBy: [],
    });
  });

  it('marks a layer whose material does not exist', async () => {
    const broken = byName(await ready, 'BROKEN WALL');
    expect(layers(broken)).toEqual([
      ['BRICK 100MM', 'opaque', 0.1],
      ['NO SUCH MATERIAL', 'missing', null],
    ]);
  });

  it('shows the fields of constructions without layers', async () => {
    const wall = byName(await ready, 'BASEMENT WALL');
    expect(wall.layers).toEqual([]);
    expect(wall.fields.map((f) => [f.label, f.value])).toEqual([
      ['C-Factor', '0.5'],
      ['Height', '2.4'],
    ]);
  });
});

describe('Constructions-8.9.idf', () => {
  it('reads Construction:InternalSource with the 8.x field names', async () => {
    const rows = await open('tests/fixtures/constructions/Constructions-8.9.idf');
    const wall = byName(rows, 'RADIANT WALL');
    expect(layers(wall)).toEqual([
      ['BRICK 100MM', 'opaque', 0.1],
      ['WALL AIR SPACE', 'airgap', null],
      ['GYPSUM 13MM', 'opaque', 0.0127],
    ]);
    expect(wall.internalSource).toMatchObject({
      className: 'Construction:InternalSource',
      afterLayer: 1,
    });
    expect(wall.internalSource?.fields.map((f) => f.label)).toContain('Tube Spacing');
    expect(wall.usage.surfaces).toBe(1);
  });
});

describe('gallery examples', () => {
  it('5ZoneAirCooledWithSpaces: glazing, gas, air boundary', async () => {
    const rows = await open('examples/5ZoneAirCooledWithSpaces.idf');
    expect(layers(byName(rows, 'Dbl Clr 3mm/13mm Air'))).toEqual([
      ['CLEAR 3MM', 'glazing', 0.003],
      ['AIR 13MM', 'gas', 0.0127],
      ['CLEAR 3MM', 'glazing', 0.003],
    ]);
    const air = byName(rows, 'AirBoundary');
    expect(air.className).toBe('Construction:AirBoundary');
    expect(air.layers).toEqual([]);
    expect(air.fields.map((f) => f.label)).toContain('Air Exchange Method');
    expect(air.usage.surfaces).toBe(2);
  });

  it('ASHRAE apartment: F-factor floors, simple glazing and internal mass', async () => {
    const rows = await open('examples/ASHRAE901_ApartmentHighRise_STD2019_Denver.idf');
    const window = byName(rows, 'ResWindow_U__SHGC_0.37');
    expect(window.layers[0]?.category).toBe('simpleglazing');
    expect(window.layers[0]?.fields.map((f) => f.label)).toEqual([
      'U-Factor',
      'Solar Heat Gain Coefficient',
      'Visible Transmittance',
    ]);
    expect(rows.filter((c) => c.className === 'Construction:FfactorGroundFloor')).toHaveLength(9);
    const furnishings = byName(rows, 'InteriorFurnishings');
    expect(furnishings.usage.surfaces).toBe(0);
    expect(furnishings.usedBy.every((u) => u.className === 'InternalMass')).toBe(true);
  });
});
