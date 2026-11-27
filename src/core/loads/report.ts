/**
 * Zone table (D3), design densities (D4) and occupancy verification (F10).
 */
import type { GeometryResult } from '../geometry/build';
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import type { ScheduleSet } from '../schedules/evaluate';
import type { Schema } from '../schema/types';
import { type LoadsResult, zoneSeries } from './loads';

export interface ZoneRow {
  name: string;
  id: number;
  multiplier: number;
  floorArea: number;
  floorAreaSource: 'input' | 'surfaces';
  volume: number;
  volumeSource: string;
  ceilingHeight: number;
  surfaces: number;
  spaces: string[];
  conditioned: boolean;
  partOfTotalArea: boolean;
  daylighting: boolean;
  people: number;
  /** W/m² at design level. */
  lights: number;
  equipment: number;
}

export function conditionedZones(model: IdfModel, schema: Schema | undefined): Set<string> {
  const result = new Set<string>();
  const add = (key: string) => {
    for (const obj of model.ofClass(key)) {
      result.add(new FieldReader(obj, schema?.classes[key]).str('Zone Name').toLowerCase());
    }
  };
  add('zonehvac:equipmentconnections');
  for (const key of model.byClass.keys()) if (key.startsWith('hvactemplate:zone:')) add(key);
  return result;
}

export function daylitZones(model: IdfModel, schema: Schema | undefined): Set<string> {
  const result = new Set<string>();
  for (const obj of model.ofClass('daylighting:controls')) {
    const r = new FieldReader(obj, schema?.classes['daylighting:controls']);
    const zone = r.str('Zone or Space Name') || r.str('Zone Name');
    if (zone) result.add(zone.toLowerCase());
  }
  return result;
}

export function zoneRows(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
  loads: LoadsResult,
): ZoneRow[] {
  const conditioned = conditionedZones(model, schema);
  const daylit = daylitZones(model, schema);
  const spaces = new Map<string, string[]>();
  for (const obj of model.ofClass('space')) {
    const zone = (obj.fields[1] ?? '').toLowerCase();
    spaces.set(zone, [...(spaces.get(zone) ?? []), obj.fields[0] ?? '']);
  }
  const byName = new Map(loads.zones.map((z) => [z.name.toLowerCase(), z]));
  return geometry.zones.map((z) => {
    const l = byName.get(z.name.toLowerCase());
    const area = z.floorArea || 1;
    const equipment = l
      ? l.watts.electric + l.watts.gas + l.watts.hotwater + l.watts.steam + l.watts.other
      : 0;
    return {
      name: z.name,
      id: z.id,
      multiplier: l?.multiplier ?? z.multiplier,
      floorArea: z.floorArea,
      floorAreaSource: z.floorAreaSource,
      volume: z.volume,
      volumeSource: z.volumeSource,
      ceilingHeight: z.ceilingHeight,
      surfaces: z.surfaceCount,
      spaces: spaces.get(z.name.toLowerCase()) ?? [],
      conditioned: conditioned.has(z.name.toLowerCase()),
      partOfTotalArea: z.partOfTotalArea,
      daylighting: daylit.has(z.name.toLowerCase()),
      people: l?.people ?? 0,
      lights: z.floorArea ? (l?.watts.lights ?? 0) / area : 0,
      equipment: z.floorArea ? equipment / area : 0,
    };
  });
}

export interface Peak {
  value: number;
  /** Timestep of the year (0-based). */
  step: number;
}

export interface OccupancyAlert {
  severity: 'warning' | 'info';
  message: string;
  objectId?: number;
}

export interface OccupancyReport {
  zones: {
    name: string;
    multiplier: number;
    design: number;
    peak: Peak;
    objects: { id: number; name: string; design: number; via?: string }[];
  }[];
  /** Occupants of the whole building at every timestep, with zone multipliers. */
  building: Float32Array;
  buildingPeak: Peak;
  buildingDesign: number;
  alerts: OccupancyAlert[];
}

function peakOf(values: Float32Array): Peak {
  let step = 0;
  for (let s = 1; s < values.length; s++)
    if ((values[s] as number) > (values[step] as number)) step = s;
  return { value: values[step] ?? 0, step };
}

export function occupancyReport(
  loads: LoadsResult,
  schedules: ScheduleSet,
  rows: ZoneRow[],
): OccupancyReport {
  const steps = schedules.calendar.dayTypes.length * schedules.steps;
  const building = new Float32Array(steps);
  const alerts: OccupancyAlert[] = [];
  const zones: OccupancyReport['zones'] = [];
  let buildingDesign = 0;
  const conditioned = new Map(rows.map((r) => [r.name.toLowerCase(), r.conditioned]));

  for (const zone of loads.zones) {
    const people = zone.instances.filter((i) => i.type === 'people');
    const series = zoneSeries(zone, schedules).people;
    for (let s = 0; s < steps; s++)
      building[s] = (building[s] as number) + (series[s] as number) * zone.multiplier;
    buildingDesign += zone.people * zone.multiplier;
    zones.push({
      name: zone.name,
      multiplier: zone.multiplier,
      design: zone.people,
      peak: peakOf(series),
      objects: people.map((p) => ({ id: p.id, name: p.name, design: p.design, via: p.via })),
    });
    if (people.length === 0 && conditioned.get(zone.name.toLowerCase())) {
      alerts.push({ severity: 'info', message: `Conditioned zone "${zone.name}" has no People.` });
    }
    if (people.length > 1) {
      alerts.push({
        severity: 'info',
        message: `Zone "${zone.name}" has ${people.length} People objects (${people.map((p) => p.name).join(', ')}); their occupants add up.`,
        objectId: people[0]?.id,
      });
    }
  }

  // Objects assigned through a list with an absolute number of people.
  const seen = new Set<number>();
  for (const zone of loads.zones) {
    for (const p of zone.instances) {
      if (p.type !== 'people' || !p.via || seen.has(p.id)) continue;
      seen.add(p.id);
      const copies = loads.zones.flatMap((z) => z.instances).filter((i) => i.id === p.id).length;
      const absolute = p.method.toLowerCase() === 'people';
      alerts.push({
        severity: absolute ? 'warning' : 'info',
        message: absolute
          ? `People "${p.name}" is assigned to the list "${p.via}" with an absolute number of people: each of its ${copies} zones gets ${p.design.toFixed(1)} people.`
          : `People "${p.name}" is assigned to the list "${p.via}" and is repeated in each of its ${copies} zones (density applied to each zone's floor area).`,
        objectId: p.id,
      });
    }
  }

  // Schedules: occupancy fractions outside 0–1 and atypical activity levels.
  const checked = new Set<string>();
  for (const zone of loads.zones) {
    for (const p of zone.instances) {
      if (p.type !== 'people') continue;
      const occ = p.schedule.toLowerCase();
      if (!checked.has(`o:${occ}`)) {
        checked.add(`o:${occ}`);
        const values = schedules.timesteps(p.schedule);
        if (values) {
          let min = Infinity;
          let max = -Infinity;
          for (const v of values) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
          if (min < -1e-6 || max > 1 + 1e-6) {
            alerts.push({
              severity: 'warning',
              message: `Occupancy schedule "${p.schedule}" goes from ${min.toFixed(2)} to ${max.toFixed(2)}; fractions are expected between 0 and 1.`,
              objectId: schedules.info(p.schedule)?.id,
            });
          }
        }
      }
      const act = p.activitySchedule?.toLowerCase();
      if (act && !checked.has(`a:${act}`)) {
        checked.add(`a:${act}`);
        const values = schedules.timesteps(p.activitySchedule as string);
        if (values) {
          let min = Infinity;
          let max = -Infinity;
          for (const v of values) {
            if (v < min) min = v;
            if (v > max) max = v;
          }
          if (min < 70 || max > 600) {
            alerts.push({
              severity: 'warning',
              message: `Activity level schedule "${p.activitySchedule}" goes from ${min.toFixed(0)} to ${max.toFixed(0)} W/person; typical values are 70–600 W/person.`,
              objectId: schedules.info(p.activitySchedule as string)?.id,
            });
          }
        }
      }
    }
  }

  return { zones, building, buildingPeak: peakOf(building), buildingDesign, alerts };
}
