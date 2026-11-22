/**
 * Zones (and spaces) that an object applies to through its "Zone or ZoneList or
 * Space or SpaceList Name" field, with the floor area its per-area methods use.
 * Shared by internal loads (F9) and infiltration and ventilation (L7, L8).
 */
import type { GeometryResult } from '../geometry/build';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import type { IdfModel } from './model';
import { FieldReader } from './reader';

export interface Target {
  zone: string;
  space?: string;
  /** Floor area of the zone, or of the space. */
  area: number;
  /** Volume of the zone, or the space's share of it by floor area. */
  volume: number;
  /** ZoneList or SpaceList the object was assigned through. */
  via?: string;
}

export type TargetResolver = (name: string) => Target[];

/** Patterns of the field that names the zone, in the order they are tried. */
export const TARGET_FIELDS = [
  /^zone or zonelist or space or spacelist name$/i,
  /^zone or zonelist name$/i,
  /^zone or space name$/i,
  /^zone name$/i,
];

export function zoneTargets(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
): TargetResolver {
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema?.classes[obj.className.toLowerCase()]);
  const zones = new Map(geometry.zones.map((z) => [z.name.toLowerCase(), z]));

  // Spaces (9.6+): zone and floor area. Surfaces without a Space Name belong to
  // the zone's space when the zone has only one.
  const spaceObjects = model.ofClass('space').map((obj) => {
    const r = reader(obj);
    return { name: r.str('Name'), zone: r.str('Zone Name'), input: r.num('Floor Area') };
  });
  const onlySpace = new Map<string, string>();
  const perZone = new Map<string, number>();
  for (const s of spaceObjects)
    perZone.set(s.zone.toLowerCase(), (perZone.get(s.zone.toLowerCase()) ?? 0) + 1);
  for (const s of spaceObjects)
    if (perZone.get(s.zone.toLowerCase()) === 1) onlySpace.set(s.zone.toLowerCase(), s.name);
  const spaceFloor = new Map<string, number>();
  for (const s of geometry.surfaces) {
    const space = s.space ?? (s.zone ? onlySpace.get(s.zone.toLowerCase()) : undefined);
    if (s.kind === 'floor' && space)
      spaceFloor.set(space.toLowerCase(), (spaceFloor.get(space.toLowerCase()) ?? 0) + s.area);
  }
  const spaces = new Map<string, { name: string; zone: string; area: number }>();
  for (const s of spaceObjects) {
    spaces.set(s.name.toLowerCase(), {
      name: s.name,
      zone: s.zone,
      area: s.input && s.input > 0 ? s.input : (spaceFloor.get(s.name.toLowerCase()) ?? 0),
    });
  }
  const spaceVolume = (s: { zone: string; area: number }) => {
    const z = zones.get(s.zone.toLowerCase());
    return z && z.floorArea > 0 ? (z.volume * s.area) / z.floorArea : 0;
  };
  const lists = (key: string) =>
    new Map(
      model
        .ofClass(key)
        .map((o) => [(o.fields[0] ?? '').toLowerCase(), o.fields.slice(1).filter(Boolean)]),
    );
  const zoneLists = lists('zonelist');
  const spaceLists = lists('spacelist');

  return (name: string): Target[] => {
    const key = name.toLowerCase();
    const zone = zones.get(key);
    if (zone) return [{ zone: zone.name, area: zone.floorArea, volume: zone.volume }];
    const space = spaces.get(key);
    if (space)
      return [
        { zone: space.zone, space: space.name, area: space.area, volume: spaceVolume(space) },
      ];
    if (zoneLists.has(key)) {
      return (zoneLists.get(key) ?? []).flatMap((z) => {
        const zone = zones.get(z.toLowerCase());
        return zone
          ? [{ zone: zone.name, area: zone.floorArea, volume: zone.volume, via: name }]
          : [];
      });
    }
    if (spaceLists.has(key)) {
      return (spaceLists.get(key) ?? []).flatMap((s) => {
        const space = spaces.get(s.toLowerCase());
        return space
          ? [
              {
                zone: space.zone,
                space: space.name,
                area: space.area,
                volume: spaceVolume(space),
                via: name,
              },
            ]
          : [];
      });
    }
    return [];
  };
}
