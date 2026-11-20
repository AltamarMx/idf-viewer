/**
 * Building summary (D1) and envelope by orientation (D2), computed from the
 * IDF input only. Areas include zone and zone list multipliers, like the
 * EnergyPlus "Input Verification" tables.
 */
import type { GeometryResult, Surface3D } from './geometry/build';
import { wrapDegrees } from './geometry/polygon';
import type { IdfModel } from './model/model';
import { FieldReader } from './model/reader';
import type { Schema } from './schema/types';

export type Orientation = 'North' | 'East' | 'South' | 'West';
export const ORIENTATIONS: Orientation[] = ['North', 'East', 'South', 'West'];

export interface EnvelopeRow {
  orientation: Orientation | 'Total';
  grossWallArea: number;
  windowArea: number;
  /** Window area / gross wall area, in %. */
  wwr: number;
}

export interface BuildingSummary {
  buildingName?: string;
  northAxis: number;
  terrain?: string;
  location?: {
    name: string;
    latitude?: number;
    longitude?: number;
    timeZone?: number;
    elevation?: number;
  };
  runPeriods: { name: string; from: string; to: string }[];
  designDays: string[];
  timestepsPerHour?: number;
  counts: {
    zones: number;
    spaces: number;
    baseSurfaces: number;
    subsurfaces: number;
    shading: number;
  };
  floorArea: { total: number; conditioned: number; unconditioned: number; excluded: number };
  /** Zones with HVAC equipment connections (or HVACTemplate zones). */
  conditionedZones: string[];
  envelope: EnvelopeRow[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const date = (month?: number, day?: number) =>
  month ? `${MONTHS[month - 1] ?? `M${month}`} ${day ?? 1}` : '—';

/** EnergyPlus' bins: North [315, 45), East [45, 135), South [135, 225), West [225, 315). */
export function orientationOf(azimuth: number): Orientation {
  const a = wrapDegrees(azimuth);
  if (a >= 315 || a < 45) return 'North';
  if (a < 135) return 'East';
  if (a < 225) return 'South';
  return 'West';
}

export function zoneMultipliers(model: IdfModel, schema: Schema): Map<string, number> {
  const result = new Map<string, number>();
  for (const obj of model.ofClass('zone')) {
    const r = new FieldReader(obj, schema.classes.zone);
    result.set(r.str('Name').toLowerCase(), r.numOr('Multiplier', 1));
  }
  // ZoneGroup multiplies every zone of its ZoneList.
  const lists = new Map<string, string[]>();
  for (const obj of model.ofClass('zonelist')) {
    lists.set(
      (obj.fields[0] ?? '').toLowerCase(),
      obj.fields.slice(1).map((z) => z.toLowerCase()),
    );
  }
  for (const obj of model.ofClass('zonegroup')) {
    const r = new FieldReader(obj, schema.classes.zonegroup);
    const factor = r.numOr('Zone List Multiplier', 1);
    for (const zone of lists.get(r.str('Zone List Name').toLowerCase()) ?? []) {
      result.set(zone, (result.get(zone) ?? 1) * factor);
    }
  }
  return result;
}

export function buildingSummary(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
): BuildingSummary {
  const summary: BuildingSummary = {
    northAxis: geometry.rules.northAxis,
    runPeriods: [],
    designDays: [],
    counts: { zones: 0, spaces: 0, baseSurfaces: 0, subsurfaces: 0, shading: 0 },
    floorArea: { total: 0, conditioned: 0, unconditioned: 0, excluded: 0 },
    conditionedZones: [],
    envelope: [],
  };
  if (!schema) return summary;
  const read = (key: string) =>
    model.ofClass(key).map((o) => new FieldReader(o, schema.classes[key]));

  const building = read('building')[0];
  if (building) {
    summary.buildingName = building.str('Name');
    summary.terrain = building.str('Terrain') || undefined;
  }
  const site = read('site:location')[0];
  if (site) {
    summary.location = {
      name: site.str('Name'),
      latitude: site.num('Latitude'),
      longitude: site.num('Longitude'),
      timeZone: site.num('Time Zone'),
      elevation: site.num('Elevation'),
    };
  }
  summary.runPeriods = read('runperiod').map((r, i) => ({
    name: r.str('Name') || `Run period ${i + 1}`,
    from: date(r.num('Begin Month'), r.num('Begin Day of Month')),
    to: date(r.num('End Month'), r.num('End Day of Month')),
  }));
  summary.designDays = read('sizingperiod:designday').map((r) => r.str('Name'));
  summary.timestepsPerHour = read('timestep')[0]?.num('Number of Timesteps per Hour');

  const conditioned = new Set<string>();
  for (const r of read('zonehvac:equipmentconnections'))
    conditioned.add(r.str('Zone Name').toLowerCase());
  for (const key of model.byClass.keys()) {
    if (!key.startsWith('hvactemplate:zone:')) continue;
    for (const r of read(key)) conditioned.add(r.str('Zone Name').toLowerCase());
  }

  const multipliers = zoneMultipliers(model, schema);
  summary.counts.zones = geometry.zones.length;
  summary.counts.spaces = model.ofClass('space').length;
  for (const z of geometry.zones) {
    const area = z.floorArea * (multipliers.get(z.name.toLowerCase()) ?? 1);
    if (!z.partOfTotalArea) {
      summary.floorArea.excluded += area;
      continue;
    }
    summary.floorArea.total += area;
    if (conditioned.has(z.name.toLowerCase())) {
      summary.floorArea.conditioned += area;
      summary.conditionedZones.push(z.name);
    } else {
      summary.floorArea.unconditioned += area;
    }
  }

  const byName = new Map<string, Surface3D>();
  for (const s of geometry.surfaces) {
    if (s.kind === 'shading') summary.counts.shading++;
    else if (['wall', 'floor', 'roof', 'ceiling'].includes(s.kind)) summary.counts.baseSurfaces++;
    else summary.counts.subsurfaces++;
    byName.set(s.name.toLowerCase(), s);
  }

  const rows = new Map<Orientation, EnvelopeRow>(
    ORIENTATIONS.map((o) => [o, { orientation: o, grossWallArea: 0, windowArea: 0, wwr: 0 }]),
  );
  const isExteriorWall = (s: Surface3D | undefined) =>
    s?.kind === 'wall' && s.boundary === 'Outdoors';
  for (const s of geometry.surfaces) {
    const mult = multipliers.get(s.zone?.toLowerCase() ?? '') ?? 1;
    if (isExteriorWall(s)) {
      (rows.get(orientationOf(s.azimuth)) as EnvelopeRow).grossWallArea += s.area * mult;
    } else if ((s.kind === 'window' || s.kind === 'glassdoor') && s.base) {
      const base = byName.get(s.base.toLowerCase());
      if (isExteriorWall(base)) {
        (rows.get(orientationOf((base as Surface3D).azimuth)) as EnvelopeRow).windowArea +=
          (s.area + (s.frameArea ?? 0)) * s.multiplier * mult;
      }
    }
  }
  const total: EnvelopeRow = { orientation: 'Total', grossWallArea: 0, windowArea: 0, wwr: 0 };
  for (const row of rows.values()) {
    total.grossWallArea += row.grossWallArea;
    total.windowArea += row.windowArea;
  }
  summary.envelope = [total, ...rows.values()].map((r) => ({
    ...r,
    wwr: r.grossWallArea > 0 ? (100 * r.windowArea) / r.grossWallArea : 0,
  }));
  return summary;
}
