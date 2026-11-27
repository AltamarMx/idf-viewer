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
import { TARGET_FIELDS, zoneTargets } from '../model/targets';
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

  const targets = zoneTargets(model, schema, geometry);

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
      const targetName = field(r, TARGET_FIELDS);
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
  /** Occupants at every timestep of the year. */
  people: Float32Array;
  /** W at every timestep by type; people = occupants × activity level. */
  watts: Record<LoadType, Float32Array>;
}

/**
 * Occupants and power of one zone at every timestep (F9), so values that change
 * within the hour (an "Until: 07:30") keep their exact time. With
 * `discountLost`, equipment counts only the heat that reaches the zone
 * (1 − Fraction Lost).
 */
export function zoneSeries(
  zone: ZoneLoads,
  schedules: ScheduleSet,
  discountLost = false,
): LoadSeries {
  const steps = schedules.calendar.dayTypes.length * schedules.steps;
  const empty = () => new Float32Array(steps);
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
    const values = schedules.timesteps(i.schedule);
    if (!values) continue;
    if (i.type === 'people') {
      const activity = i.activitySchedule ? schedules.timesteps(i.activitySchedule) : null;
      for (let s = 0; s < steps; s++) {
        const count = i.design * (values[s] as number);
        series.people[s] = (series.people[s] as number) + count;
        series.watts.people[s] = (series.watts.people[s] as number) + count * (activity?.[s] ?? 0);
      }
    } else {
      // Other equipment reports only the heat gain; the rest report consumption.
      const factor = i.type === 'other' || discountLost ? 1 - i.fractionLost : 1;
      const target = series.watts[i.type];
      for (let s = 0; s < steps; s++)
        target[s] = (target[s] as number) + i.design * factor * (values[s] as number);
    }
  }
  return series;
}
