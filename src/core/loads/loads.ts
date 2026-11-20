/**
 * Internal loads and occupancy per zone (D4, F9, F10), from the IDF input only.
 *
 * Every People / Lights / *Equipment object is resolved to the zones it applies
 * to (Zone, ZoneList, Space, SpaceList), and its design level is computed with
 * its calculation method (absolute, per floor area, per person), like EnergyPlus.
 * Values over time are design level × schedule. Zone multipliers are not
 * included in zone values; building totals include them.
 */
import type { GeometryResult } from '../geometry/build';
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import type { IdfObject } from '../parser/idf';
import type { ScheduleSet } from '../schedules/evaluate';
import type { Schema } from '../schema/types';
import { zoneMultipliers } from '../summary';

export type LoadType = 'people' | 'lights' | 'electric' | 'gas' | 'hotwater' | 'steam' | 'other';

export const LOAD_CLASSES: Record<string, LoadType> = {
  people: 'people',
  lights: 'lights',
  electricequipment: 'electric',
  gasequipment: 'gas',
  hotwaterequipment: 'hotwater',
  steamequipment: 'steam',
  otherequipment: 'other',
};

export const LOAD_LABELS: Record<LoadType, string> = {
  people: 'People',
  lights: 'Lights',
  electric: 'Electric equipment',
  gas: 'Gas equipment',
  hotwater: 'Hot water equipment',
  steam: 'Steam equipment',
  other: 'Other equipment',
};

/** One load object applied to one zone (a ZoneList object gives one per zone). */
export interface LoadInstance {
  id: number;
  name: string;
  className: string;
  type: LoadType;
  zone: string;
  space?: string;
  /** ZoneList or SpaceList the object was assigned through. */
  via?: string;
  method: string;
  /** People for People objects, W for the rest. */
  design: number;
  schedule: string;
  activitySchedule?: string;
  fractionLost: number;
}

export interface ZoneLoads {
  name: string;
  multiplier: number;
  floorArea: number;
  volume: number;
  people: number;
  /** Design W by load type (people: occupants × activity is time-dependent, not here). */
  watts: Record<Exclude<LoadType, 'people'>, number>;
  instances: LoadInstance[];
}

export interface LoadsResult {
  zones: ZoneLoads[];
  warnings: { objectId: number; message: string }[];
}

function field(r: FieldReader, patterns: RegExp[]): string {
  const fields = r.cls?.fields ?? [];
  for (const pattern of patterns) {
    const f = fields.find((x) => pattern.test(x.name));
    if (f) return r.str(f.name);
  }
  return '';
}

const num = (text: string) => {
  const n = Number(text);
  return text !== '' && Number.isFinite(n) ? n : undefined;
};

export function resolveLoads(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
): LoadsResult {
  const warnings: LoadsResult['warnings'] = [];
  if (!schema) return { zones: [], warnings };
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);
  const multipliers = zoneMultipliers(model, schema);

  const zones = new Map<string, ZoneLoads>();
  for (const z of geometry.zones) {
    zones.set(z.name.toLowerCase(), {
      name: z.name,
      multiplier: multipliers.get(z.name.toLowerCase()) ?? 1,
      floorArea: z.floorArea,
      volume: z.volume,
      people: 0,
      watts: { lights: 0, electric: 0, gas: 0, hotwater: 0, steam: 0, other: 0 },
      instances: [],
    });
  }

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
  const lists = (key: string) =>
    new Map(
      model
        .ofClass(key)
        .map((o) => [(o.fields[0] ?? '').toLowerCase(), o.fields.slice(1).filter(Boolean)]),
    );
  const zoneLists = lists('zonelist');
  const spaceLists = lists('spacelist');

  /** Zones (and spaces) an object applies to, with the floor area its per-area methods use. */
  type Target = { zone: string; space?: string; area: number; via?: string };
  const targets = (name: string): Target[] => {
    const key = name.toLowerCase();
    if (zones.has(key)) {
      const z = zones.get(key) as ZoneLoads;
      return [{ zone: z.name, area: z.floorArea }];
    }
    if (spaces.has(key)) {
      const s = spaces.get(key) as { name: string; zone: string; area: number };
      return [{ zone: s.zone, space: s.name, area: s.area }];
    }
    if (zoneLists.has(key)) {
      return (zoneLists.get(key) ?? []).flatMap((z) => {
        const zone = zones.get(z.toLowerCase());
        return zone ? [{ zone: zone.name, area: zone.floorArea, via: name }] : [];
      });
    }
    if (spaceLists.has(key)) {
      return (spaceLists.get(key) ?? []).flatMap((s) => {
        const space = spaces.get(s.toLowerCase());
        return space ? [{ zone: space.zone, space: space.name, area: space.area, via: name }] : [];
      });
    }
    return [];
  };

  const TARGET = [
    /^zone or zonelist or space or spacelist name$/i,
    /^zone or zonelist name$/i,
    /^zone name$/i,
  ];
  const METHOD = [/calculation method$/i];

  const add = (instance: LoadInstance) => {
    const zone = zones.get(instance.zone.toLowerCase());
    if (!zone) return;
    zone.instances.push(instance);
    if (instance.type === 'people') zone.people += instance.design;
    else zone.watts[instance.type] += instance.design;
  };

  // People first: Watts/Person loads need the number of people of each zone.
  const order = Object.entries(LOAD_CLASSES).sort(([, a], [, b]) =>
    a === 'people' ? -1 : b === 'people' ? 1 : 0,
  );
  for (const [className, type] of order) {
    for (const obj of model.ofClass(className)) {
      const r = reader(obj);
      const targetName = field(r, TARGET);
      const list = targets(targetName);
      if (list.length === 0) {
        warnings.push({
          objectId: obj.id,
          message: `"${targetName}" is not a zone, space or list; the load is not counted.`,
        });
        continue;
      }
      const method = field(r, METHOD).toLowerCase();
      for (const t of list) {
        let design = 0;
        if (type === 'people') {
          if (method.includes('area/person')) {
            const perPerson = num(field(r, [/floor area per person$/i]));
            design = perPerson ? t.area / perPerson : 0;
          } else if (method.includes('people/area')) {
            design = (num(field(r, [/^people per (zone )?floor area$/i])) ?? 0) * t.area;
          } else {
            design = num(field(r, [/^number of people$/i])) ?? 0;
          }
        } else {
          const level = [/^lighting level$/i, /^design level$/i];
          const perArea = [/^(watts|power) per (zone )?floor area$/i];
          const perPerson = [/^(watts|power) per person$/i];
          if (method.includes('/area')) {
            design = (num(field(r, perArea)) ?? 0) * t.area;
          } else if (method.includes('/person')) {
            const zone = zones.get(t.zone.toLowerCase());
            const people = t.space
              ? (zone?.instances ?? [])
                  .filter(
                    (i) => i.type === 'people' && i.space?.toLowerCase() === t.space?.toLowerCase(),
                  )
                  .reduce((n, i) => n + i.design, 0)
              : (zone?.people ?? 0);
            design = (num(field(r, perPerson)) ?? 0) * people;
          } else {
            design = num(field(r, level)) ?? 0;
          }
        }
        add({
          id: obj.id,
          name: r.str('Name'),
          className: obj.className,
          type,
          zone: t.zone,
          space: t.space,
          via: t.via,
          method: field(r, METHOD),
          design,
          schedule: field(r, [/^number of people schedule name$/i, /^schedule name$/i]),
          activitySchedule:
            type === 'people' ? r.str('Activity Level Schedule Name') || undefined : undefined,
          fractionLost: num(r.str('Fraction Lost')) ?? 0,
        });
      }
    }
  }
  return { zones: [...zones.values()], warnings };
}

export interface LoadSeries {
  /** Occupants per hour. */
  people: Float32Array;
  /** W per hour by type; people = occupants × activity level. */
  watts: Record<LoadType, Float32Array>;
}

/**
 * Hourly occupants and power of one zone (F9). With `discountLost`, equipment
 * counts only the heat that reaches the zone (1 − Fraction Lost).
 */
export function zoneSeries(
  zone: ZoneLoads,
  schedules: ScheduleSet,
  discountLost = false,
): LoadSeries {
  const hours = schedules.calendar.dayTypes.length * 24;
  const empty = () => new Float32Array(hours);
  const series: LoadSeries = {
    people: empty(),
    watts: {
      people: empty(),
      lights: empty(),
      electric: empty(),
      gas: empty(),
      hotwater: empty(),
      steam: empty(),
      other: empty(),
    },
  };
  for (const i of zone.instances) {
    const values = schedules.hourly(i.schedule);
    if (!values) continue;
    if (i.type === 'people') {
      const activity = i.activitySchedule ? schedules.hourly(i.activitySchedule) : null;
      for (let h = 0; h < hours; h++) {
        const count = i.design * (values[h] as number);
        series.people[h] = (series.people[h] as number) + count;
        series.watts.people[h] = (series.watts.people[h] as number) + count * (activity?.[h] ?? 0);
      }
    } else {
      // Other equipment reports only the heat gain; the rest report consumption.
      const factor = i.type === 'other' || discountLost ? 1 - i.fractionLost : 1;
      const target = series.watts[i.type];
      for (let h = 0; h < hours; h++)
        target[h] = (target[h] as number) + i.design * factor * (values[h] as number);
    }
  }
  return series;
}
