/**
 * Daylighting reference points (C9) and floor levels of the 3D layers (C7).
 */
import { describe, expect, it } from 'vitest';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();

/** A zone with its origin at (10, 5, 0) and two points, before 8.6. */
const OLD_FORMAT = (coordinates: string, northAxis: number) => `
Version,8.5;
Building,B,${northAxis},Suburbs,0.04,0.4,FullExterior,25,6;
GlobalGeometryRules,UpperLeftCorner,Counterclockwise,Relative,${coordinates};
Zone,Office,0,10,5,0;
Daylighting:Controls,Office,2,2,3,0.8,4,3,0.8,0.5,0.5,500,500,1;
`;

describe('daylighting reference points', () => {
  it('reads Daylighting:ReferencePoint (8.6+) in the small office', async () => {
    const path = 'examples/AirflowNetwork_MultiZone_SmallOffice.idf';
    const session = await openFile({ name: path, buffer: fileBuffer(path) }, loader);
    const points = session.geometry.daylightingPoints;
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ name: 'West Zone_DaylRefPt1', zone: 'West Zone' });
  });

  it('reads the 48 points of the hospital', async () => {
    const path = 'examples/HospitalLowEnergy.idf';
    const session = await openFile({ name: path, buffer: fileBuffer(path) }, loader);
    expect(session.geometry.daylightingPoints).toHaveLength(48);
    // In the 3D view they are relative to the center of the model, like the surfaces.
    expect(session.geometryView().daylightingPoints).toHaveLength(48);
  });

  it('moves relative points with the zone origin and the building north axis', async () => {
    const session = await openFile({ name: 'a.idf', text: OLD_FORMAT('Relative', 0) }, loader);
    expect(session.geometry.daylightingPoints.map((p) => p.position)).toEqual([
      [12, 8, 0.8],
      [14, 8, 0.8],
    ]);
    const rotated = await openFile({ name: 'b.idf', text: OLD_FORMAT('Relative', 90) }, loader);
    const [x, y, z] = rotated.geometry.daylightingPoints[0]?.position ?? [];
    // North axis 90°: the building's y axis points east.
    expect([x, y, z].map((v) => Math.round((v ?? Number.NaN) * 1000) / 1000)).toEqual([
      8, -12, 0.8,
    ]);
  });

  it('keeps World points as written', async () => {
    const session = await openFile({ name: 'c.idf', text: OLD_FORMAT('World', 90) }, loader);
    expect(session.geometry.daylightingPoints[0]?.position).toEqual([2, 3, 0.8]);
  });
});

describe('floor levels', () => {
  it('gives each surface the floor level of its zone', async () => {
    const path = 'examples/AirflowNetwork_MultiZone_SmallOffice.idf';
    const session = await openFile({ name: path, buffer: fileBuffer(path) }, loader);
    const view = session.geometryView();
    const levels = new Map(view.surfaces.map((s) => [s.zone, s.level]));
    expect(levels.get('West Zone')).toBe(0);
    expect(levels.get('ATTIC ZONE')).toBe(3);
  });
});
