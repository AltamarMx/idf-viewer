/**
 * AirflowNetwork summary (L3) and opening card (L4, L5).
 */
import { describe, expect, it } from 'vitest';
import { interpolateSet } from '../src/core/airflow/afn';
import type { AfnField } from '../src/core/airflow/card';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();
const open = (path: string) => openFile({ name: path, buffer: fileBuffer(path) }, loader);
const value = (fields: AfnField[], label: string) => fields.find((f) => f.label === label);

describe('interpolateSet', () => {
  it('interpolates Cd, width, height and start height factors', () => {
    const sets = [
      { openingFactor: 0, cd: 0.4, widthFactor: 0, heightFactor: 1, startHeightFactor: 0 },
      { openingFactor: 1, cd: 0.6, widthFactor: 1, heightFactor: 0.5, startHeightFactor: 0.2 },
    ];
    expect(interpolateSet(sets, 0.5)).toEqual({
      openingFactor: 0.5,
      cd: expect.closeTo(0.5),
      widthFactor: expect.closeTo(0.5),
      heightFactor: expect.closeTo(0.75),
      startHeightFactor: expect.closeTo(0.1),
    });
  });
});

describe('AirflowNetwork_MultiZone_SmallOffice', () => {
  const ready = open('examples/AirflowNetwork_MultiZone_SmallOffice.idf');

  it('summarizes control, zones, nodes and components', async () => {
    const o = (await ready).afnOverview();
    expect(o.active).toBe(true);
    expect(o.cpInput).toBe(true);
    expect(value(o.settings, 'AirflowNetwork Control')?.value).toBe('MultizoneWithDistribution');
    expect(o.zones.map((z) => [z.name, z.mode, z.surfaces, z.operable])).toEqual([
      // Both sides of interzone surfaces count: the attic has its 3 roofs and
      // the 3 ceilings below it.
      ['West Zone', 'Temperature', 7, 2],
      ['EAST ZONE', 'NoVent', 5, 0],
      ['NORTH ZONE', 'Temperature', 8, 2],
      ['ATTIC ZONE', 'NoVent', 6, 0],
    ]);
    expect(o.nodes.find((n) => n.name === 'SFacade')).toMatchObject({
      height: 1.524,
      cp: 'SFacade_WPCValue',
      uses: 3,
    });
    expect(o.components.find((c) => c.type === 'crack')).toMatchObject({ objects: 2 });
    expect(o.surfaces).toHaveLength(19);
  });

  it('builds the card of a ZoneLevel window: values from the zone, sets, node and Cp', async () => {
    const card = (await ready).afnCard('Zn001:Wall001:Win001');
    if (!card) throw new Error('no card');
    expect(card.surface).toMatchObject({ width: 5, height: 2, rectangular: true });
    const mode = value(card.control, 'Ventilation control mode');
    expect(mode).toMatchObject({ value: 'Temperature', from: 'zone' });
    expect(value(card.control, 'Temperature setpoint schedule')).toMatchObject({
      value: 'WindowVentSched',
      from: 'zone',
      unused: false,
    });
    expect(value(card.control, 'Minimum venting open factor')?.value).toBe('0.3');
    // Temperature control does not use the enthalpy limits.
    expect(value(card.control, 'Δh lower limit (fully open)')?.unused).toBe(true);
    expect(card.component.sets).toHaveLength(2);
    expect(card.component.atFactor?.cd).toBeCloseTo(0.55);
    expect(card.component.openArea).toBeCloseTo(5);
    expect(card.component.effectiveArea).toBeCloseTo(2.75);
    expect(card.node?.cp?.directions.slice(0, 3)).toEqual([0, 30, 60]);
    expect(card.node?.cp?.values).toHaveLength(card.node?.cp?.directions.length as number);
  });

  it('uses the zone of the listed side for the other side of an interzone door', async () => {
    const card = (await ready).afnCard('Zn003:Wall004:Door001');
    expect(card?.link.viaPartner).toBe('Zn001:Wall003:Door001');
    // West Zone (the listed side) has 0.3; NORTH ZONE has 1.0.
    expect(value(card?.control ?? [], 'Minimum venting open factor')?.value).toBe('0.3');
    expect(card?.notes[0]?.kind).toBe('info');
  });
});

describe('Windows.idf', () => {
  const ready = open('tests/fixtures/windows/Windows.idf');

  it('marks the values a Constant surface does not use', async () => {
    const card = (await ready).afnCard('GlassDoor:North');
    if (!card) throw new Error('no card');
    expect(value(card.control, 'Ventilation control mode')).toMatchObject({
      value: 'Constant',
      from: 'surface',
    });
    expect(value(card.control, 'ΔT lower limit (fully open)')?.unused).toBe(true);
    expect(value(card.control, 'Venting availability schedule')).toMatchObject({
      value: '',
      unused: false,
      blank: 'always available',
    });
    // Three sets; the surface factor 0.25 lies between the first two.
    expect(card.component.atFactor).toMatchObject({
      cd: expect.closeTo(0.45),
      widthFactor: expect.closeTo(0.25),
    });
    expect(card.component.openArea).toBeCloseTo(2 * 2.2 * 0.25);
    expect(card.notes.map((n) => n.kind)).toEqual(['info']);
  });

  it('computes the open area of simple and horizontal openings', async () => {
    const session = await ready;
    expect(session.afnCard('Win:South')?.component.openArea).toBeCloseTo(6 * 0.5);
    expect(session.afnCard('Door:West')?.control).toEqual([]);
    // A HorizontalOpening must be between two zones: the 1 × 1 m hatch from Zone 1
    // to the plenum in Network.idf.
    const path = 'tests/fixtures/ventilation/Network.idf';
    const network = await openFile({ name: path, buffer: fileBuffer(path) }, loader);
    expect(network.afnCard('Hatch-1')?.component).toMatchObject({
      openArea: expect.closeTo(1 * 0.4),
      effectiveArea: expect.closeTo(1 * 0.4 * 0.6),
    });
  });
});

describe('opening rules (L6)', () => {
  it('modulates the opening linearly between the ΔT limits', async () => {
    const { modulatedFactor, openingRule } = await import('../src/core/airflow/rules');
    const rule = openingRule({
      mode: 'Temperature',
      maxFactor: 0.8,
      minFactor: 0.25,
      deltaT: [5, 15],
      deltaH: [0, 300000],
    });
    expect(rule).toMatchObject({ kind: 'modulated', variable: 'ΔT', lower: 5, upper: 15 });
    expect(modulatedFactor(rule, -1)).toBe(0);
    expect(modulatedFactor(rule, 3)).toBeCloseTo(0.8);
    expect(modulatedFactor(rule, 10)).toBeCloseTo(0.8 * (1 - 0.5 * 0.75));
    expect(modulatedFactor(rule, 20)).toBeCloseTo(0.2);
    expect(
      openingRule({ ...rule, mode: 'Enthalpy', deltaT: [0, 100], deltaH: [10, 5] }),
    ).toMatchObject({
      // EnergyPlus warns and uses 300000 J/kg when the upper limit is not above the lower one.
      variable: 'Δh',
      upper: 300000,
      inputUpper: 5,
    });
    expect(openingRule({ ...rule, mode: 'NoVent', deltaT: [0, 100], deltaH: [0, 1] }).kind).toBe(
      'closed',
    );
  });

  it('builds the rule from the zone with ZoneLevel and counts available hours', async () => {
    const session = await open('examples/AirflowNetwork_MultiZone_SmallOffice.idf');
    const card = session.afnCard('Zn001:Wall001:Win001');
    expect(card?.rule).toMatchObject({
      kind: 'modulated',
      maxFactor: 0.5,
      minFactor: 0.3,
      lower: 5,
      upper: 10,
    });
    expect(card?.rule?.conditions.join(' ')).toContain('WindowVentSched');
    const availability = card?.availability;
    expect(availability).toMatchObject({ schedule: 'VentingSched', evaluable: true });
    expect(availability?.hours).toBeGreaterThan(0);
    expect(availability?.hours).toBeLessThanOrEqual(availability?.total ?? 0);
  });

  it('a Constant opening without schedule is always available', async () => {
    const session = await open('tests/fixtures/windows/Windows.idf');
    const card = session.afnCard('GlassDoor:North');
    expect(card?.rule?.kind).toBe('constant');
    expect(card?.availability).toMatchObject({ hours: 8760, total: 8760 });
    // ZoneLevel resolves to NoVent here: closed, no availability.
    const east = session.afnCard('Win:East');
    expect(east?.rule?.kind).toBe('closed');
    expect(east?.availability).toBeUndefined();
  });
});
