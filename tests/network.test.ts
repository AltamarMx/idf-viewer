/**
 * Flow network between zones (L11): AirflowNetwork links and zone mixing.
 */
import { describe, expect, it } from 'vitest';
import type { FlowNetwork } from '../src/core/airflow/network';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();
const open = async (path: string) =>
  (await openFile({ name: path, buffer: fileBuffer(path) }, loader)).network();

/** Links as "from → to · type (surfaces)", with names instead of keys. */
function describeLinks(n: FlowNetwork): string[] {
  const name = (key: string) => n.nodes.find((x) => x.key === key)?.name ?? key;
  return n.links
    .map((l) => {
      const arrow = l.direction === 'forward' ? '→' : l.direction === 'both' ? '↔' : '—';
      const items = [...l.surfaces.map((s) => s.name), ...l.objects.map((o) => o.name)];
      return `${name(l.from)} ${arrow} ${name(l.to)} · ${l.type} (${items.join(', ')})`;
    })
    .sort();
}

describe('AirflowNetwork_MultiZone_House', () => {
  const ready = open('examples/AirflowNetwork_MultiZone_House.idf');

  it('links the three zones with each other and with their external nodes', async () => {
    const n = await ready;
    expect(n.afn).toMatchObject({ present: true, active: true, cpInput: true });
    expect(n.nodes.filter((x) => x.kind === 'zone').map((x) => [x.name, x.level])).toEqual([
      ['LIVING ZONE', 0],
      ['GARAGE ZONE', 0],
      ['ATTIC ZONE', 2.4],
    ]);
    expect(describeLinks(n)).toEqual([
      'ATTIC ZONE — GARAGE ZONE · crack (Garage:Ceiling)',
      'ATTIC ZONE — LIVING ZONE · crack (Living:Ceiling)',
      'ATTIC ZONE — SFacade · crack (EastRoof)',
      'GARAGE ZONE — LIVING ZONE · crack (Living:Interior)',
      'GARAGE ZONE — NFacade · crack (Garage:FrontDoor)',
      'LIVING ZONE — WFacade · crack (Living:West)',
    ]);
    expect(n.zonesOutside).toEqual([]);
  });

  it('places each external node where its surfaces face', async () => {
    const n = await ready;
    const node = (name: string) => n.nodes.find((x) => x.name === name);
    expect(node('WFacade')).toMatchObject({ kind: 'outdoor', facing: 'West' });
    // SFacade is used only by the east roof.
    expect(node('SFacade')).toMatchObject({ facing: 'Roof' });
  });

  it('warns about the external node that no surface uses', async () => {
    const n = await ready;
    expect(n.warnings.map((w) => w.message)).toEqual([
      'External node EFacade is not used by any surface.',
    ]);
  });
});

describe('AirflowNetwork_MultiZone_SmallOffice', () => {
  it('keeps each component type as its own link and the exhaust fan directed', async () => {
    const n = await open('examples/AirflowNetwork_MultiZone_SmallOffice.idf');
    const links = describeLinks(n);
    expect(links).toContain('West Zone — SFacade · detailedopening (Zn001:Wall001:Win001)');
    expect(links).toContain('West Zone — SFacade · ela (Zn001:Wall001)');
    expect(links).toContain('NORTH ZONE → EFacade · exhaustfan (Zn003:Wall003)');
    expect(links).toContain(
      'ATTIC ZONE — Horizontal · crack (Zn004:Roof001, Zn004:Roof002, Zn004:Roof003)',
    );
    expect(n.links.find((l) => l.type === 'simpleopening')?.surfaces[0]?.cd).toBeCloseTo(0.55);
    expect(n.warnings).toEqual([]);
  });
});

describe('Network.idf', () => {
  const ready = open('tests/fixtures/ventilation/Network.idf');

  it('groups the outdoors by facade when EnergyPlus computes the Cp', async () => {
    const n = await ready;
    expect(n.afn.cpInput).toBe(false);
    const outdoor = n.nodes.filter((x) => x.kind === 'outdoor');
    // North Axis is 30°, so the front faces 210° and is still south.
    expect(outdoor.map((x) => [x.name, x.facing, Math.round(x.azimuth ?? -1)])).toEqual([
      ['Outdoors · South', 'South', 210],
      ['Outdoors · East', 'East', 120],
      ['Outdoors · North', 'North', 30],
      ['Outdoors · West', 'West', 300],
    ]);
  });

  it('links interzone surfaces, openings, fans and mixing', async () => {
    const n = await ready;
    expect(describeLinks(n)).toEqual([
      'Zone 1 — Outdoors · South · crack (FRONT-1)',
      'Zone 1 — Outdoors · South · detailedopening (WF-1)',
      'Zone 1 — Zone 2 · detailedopening (SB12)',
      'Zone 1 — Zone 4 · crack (SB14)',
      'Zone 2 — Outdoors · East · crack (RIGHT-1)',
      'Zone 2 — Zone 3 · crack (SB32)',
      'Zone 3 — Outdoors · North · crack (BACK-1, BACK-3)',
      'Zone 3 → Outdoors · North · exhaustfan (BACK-2)',
      'Zone 3 ↔ Zone 5 · crossmixing (Zone 3 and Zone 5 Cross Mixing)',
      'Zone 4 — Outdoors · West · crack (LEFT-1)',
      'Zone 4 → Zone 5 · mixing (Zone 4 to Zone 5 Mixing)',
    ]);
  });

  it('keeps the values of each link', async () => {
    const n = await ready;
    const link = (type: string, surface?: string) =>
      n.links.find(
        (l) => l.type === type && (!surface || l.surfaces.some((s) => s.name === surface)),
      );
    // Cd interpolated at the opening factor 0.5, between 0.5 and 0.6.
    expect(link('detailedopening', 'WF-1')?.surfaces[0]).toMatchObject({ factor: 0.5 });
    expect(link('detailedopening', 'WF-1')?.surfaces[0]?.cd).toBeCloseTo(0.55);
    // SB32 is in Zone 3, the second zone of the link.
    expect(link('crack', 'SB32')?.surfaces[0]).toMatchObject({ reversed: true, factor: 0.5 });
    expect(link('mixing')?.objects[0]?.design).toBeCloseTo(0.05);
    expect(link('crossmixing')?.objects[0]?.design).toBeCloseTo(0.1);
  });

  it('warns about a network zone without surfaces and lists the zones left out', async () => {
    const n = await ready;
    expect(n.warnings.map((w) => w.message)).toEqual([
      'Zone 5 has an AirflowNetwork:MultiZone:Zone but no surface in the network.',
    ]);
    expect(n.zonesOutside).toEqual(['PLENUM-1']);
  });
});

describe('without AirflowNetwork or mixing', () => {
  it('has no nodes', async () => {
    const n = await open('examples/1ZoneUncontrolled.idf');
    expect(n.afn.present).toBe(false);
    expect(n.nodes).toEqual([]);
    expect(n.zonesOutside).toEqual([]);
  });
});
