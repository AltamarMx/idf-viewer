/**
 * Where each schedule is used (F7) and which schedules affect a zone (F8).
 *
 * A use is an object field that names the schedule. The zones of a use come
 * from the object's own zone, space or list fields; otherwise from the surface
 * it refers to; otherwise from the objects that refer to it (e.g. a setpoint
 * object used by a ZoneControl:Thermostat), up to two levels away.
 */
import type { GeometryResult } from '../geometry/build';
import type { IdfModel } from '../model/model';
import type { ReferenceIndex } from '../model/references';
import type { IdfObject } from '../parser/idf';
import { fieldSchema } from '../schema/fields';
import type { Schema } from '../schema/types';

export type UseGroup =
  | 'Occupancy'
  | 'Activity and comfort'
  | 'Lighting'
  | 'Equipment'
  | 'Infiltration'
  | 'Ventilation and mixing'
  | 'Airflow network'
  | 'Thermostats and controls'
  | 'Windows and shading'
  | 'HVAC'
  | 'Other';

export const USE_GROUPS: UseGroup[] = [
  'Occupancy',
  'Activity and comfort',
  'Lighting',
  'Equipment',
  'Infiltration',
  'Ventilation and mixing',
  'Airflow network',
  'Thermostats and controls',
  'Windows and shading',
  'HVAC',
  'Other',
];

export interface ScheduleUse {
  objectId: number;
  className: string;
  objectName?: string;
  fieldName: string;
  group: UseGroup;
  zones: string[];
}

function groupOf(className: string, fieldName: string): UseGroup {
  const c = className.toLowerCase();
  const f = fieldName.toLowerCase();
  if (c === 'people') {
    return f.startsWith('number of people') ? 'Occupancy' : 'Activity and comfort';
  }
  if (c === 'lights' || c.startsWith('daylighting')) return 'Lighting';
  if (
    /^(electric|gas|hotwater|steam|other)equipment$/.test(c) ||
    c.startsWith('electricequipment:')
  )
    return 'Equipment';
  if (c.startsWith('zoneinfiltration')) return 'Infiltration';
  if (
    c.startsWith('zoneventilation') ||
    c.startsWith('zonemixing') ||
    c.startsWith('zonecrossmixing') ||
    c.startsWith('zoneairbalance') ||
    c.startsWith('zonerefrigerationdoormixing') ||
    c.startsWith('zonethermalchimney') ||
    c.startsWith('zoneearthtube') ||
    c.startsWith('zonecooltower')
  ) {
    return 'Ventilation and mixing';
  }
  if (c.startsWith('airflownetwork')) return 'Airflow network';
  if (
    c.startsWith('zonecontrol') ||
    c.startsWith('thermostatsetpoint') ||
    c.startsWith('setpointmanager') ||
    c.startsWith('availabilitymanager')
  ) {
    return 'Thermostats and controls';
  }
  if (
    c.startsWith('windowshadingcontrol') ||
    c.startsWith('windowproperty') ||
    c.startsWith('shading') ||
    c.startsWith('windowmaterial')
  ) {
    return 'Windows and shading';
  }
  if (
    c.startsWith('zonehvac') ||
    c.startsWith('airloophvac') ||
    c.startsWith('airterminal') ||
    c.startsWith('fan') ||
    c.startsWith('coil') ||
    c.startsWith('hvactemplate') ||
    c.startsWith('sizing') ||
    c.startsWith('controller') ||
    c.startsWith('plant') ||
    c.startsWith('pump') ||
    c.startsWith('boiler') ||
    c.startsWith('chiller')
  ) {
    return 'HVAC';
  }
  return 'Other';
}

const ZONE_LISTS = /zone|space/i;
const SURFACE_LISTS = /surf/i;

export class ScheduleUsage {
  private readonly zonesByName = new Map<string, string>();
  private readonly zoneLists = new Map<string, string[]>();
  private readonly spaceZone = new Map<string, string>();
  private readonly surfaceZone = new Map<string, string>();
  private readonly cache = new Map<number, string[]>();

  constructor(
    private readonly model: IdfModel,
    private readonly schema: Schema | undefined,
    private readonly references: ReferenceIndex,
    geometry: GeometryResult,
  ) {
    for (const z of geometry.zones) this.zonesByName.set(z.name.toLowerCase(), z.name);
    for (const obj of model.ofClass('space')) {
      this.spaceZone.set((obj.fields[0] ?? '').toLowerCase(), obj.fields[1] ?? '');
    }
    for (const key of ['zonelist', 'spacelist']) {
      for (const obj of model.ofClass(key)) {
        const members = obj.fields.slice(1).filter(Boolean);
        const zones =
          key === 'zonelist'
            ? members
            : members.map((s) => this.spaceZone.get(s.toLowerCase()) ?? '');
        this.zoneLists.set((obj.fields[0] ?? '').toLowerCase(), zones.filter(Boolean));
      }
    }
    for (const s of geometry.surfaces)
      if (s.zone) this.surfaceZone.set(s.name.toLowerCase(), s.zone);
  }

  private cls(obj: IdfObject) {
    return this.schema?.classes[obj.className.toLowerCase()];
  }

  private resolveZone(value: string): string[] {
    const key = value.toLowerCase();
    const zone = this.zonesByName.get(key);
    if (zone) return [zone];
    const fromSpace = this.spaceZone.get(key);
    if (fromSpace) return [this.zonesByName.get(fromSpace.toLowerCase()) ?? fromSpace];
    return (this.zoneLists.get(key) ?? []).map((z) => this.zonesByName.get(z.toLowerCase()) ?? z);
  }

  /** Zones an object applies to (see module comment). */
  zonesOf(id: number, depth = 0): string[] {
    const cached = this.cache.get(id);
    if (cached && depth === 0) return cached;
    const obj = this.model.objects[id] as IdfObject;
    const cls = this.cls(obj);
    const zones = new Set<string>();
    const surfaces: string[] = [];
    obj.fields.forEach((value, i) => {
      if (!value) return;
      const lists = fieldSchema(cls, i)?.objectList ?? [];
      if (lists.some((l) => ZONE_LISTS.test(l)))
        for (const z of this.resolveZone(value)) zones.add(z);
      else if (lists.some((l) => SURFACE_LISTS.test(l))) surfaces.push(value);
    });
    if (zones.size === 0) {
      for (const s of surfaces) {
        const z = this.surfaceZone.get(s.toLowerCase());
        if (z) zones.add(z);
      }
    }
    if (zones.size === 0 && depth < 2) {
      for (const edge of this.references.usedBy.get(id) ?? []) {
        for (const z of this.zonesOf(edge.from, depth + 1)) zones.add(z);
      }
    }
    const result = [...zones];
    if (depth === 0) this.cache.set(id, result);
    return result;
  }

  /** Every field that uses the schedule object `scheduleId`. */
  usesOf(scheduleId: number): ScheduleUse[] {
    return (this.references.usedBy.get(scheduleId) ?? []).map((edge) => {
      const obj = this.model.objects[edge.from] as IdfObject;
      const cls = this.cls(obj);
      const fieldName = fieldSchema(cls, edge.field)?.name ?? `Field ${edge.field + 1}`;
      const named = Boolean(cls?.fields[0]?.reference);
      return {
        objectId: obj.id,
        className: cls?.name ?? obj.className,
        objectName: named ? obj.fields[0] : undefined,
        fieldName,
        group: groupOf(obj.className, fieldName),
        zones: this.zonesOf(obj.id),
      };
    });
  }
}
