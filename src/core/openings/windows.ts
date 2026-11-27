/**
 * Inventory of windows and doors (L1): every subsurface with its host surface,
 * zone, orientation, size, construction, frame, shading control and, when the
 * file has an AirflowNetwork, how it takes part in it.
 */
import type { AfnModel, AfnSurfaceLink } from '../airflow/afn';
import type { GeometryResult, Surface3D } from '../geometry/build';
import { length, sub, type Vec3 } from '../geometry/polygon';
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import { type Orientation, orientationOf, zoneMultipliers } from '../summary';

export type OpeningKind = 'window' | 'glassdoor' | 'door' | 'tdd';
export type Facing = Orientation | 'Roof' | 'Floor';

export interface ShadingControlRef {
  id: number;
  name: string;
  /** "InteriorShade", "ExteriorBlind", "SwitchableGlazing"… */
  shadingType: string;
  /** "OnIfHighSolarOnWindow", "AlwaysOn"… */
  controlType: string;
}

export interface SimpleGlazing {
  id: number;
  name: string;
  u?: number;
  shgc?: number;
  vt?: number;
}

export interface WindowRow {
  id: number;
  name: string;
  className: string;
  kind: OpeningKind;
  zone?: string;
  base?: string;
  baseId?: number;
  /** Boundary condition of the host surface. */
  boundary?: string;
  azimuth: number;
  tilt: number;
  facing: Facing;
  /** Only for rectangles. */
  width?: number;
  height?: number;
  /** Bottom and top of the opening above the lowest point of its host surface (vertical surfaces). */
  sill?: number;
  head?: number;
  /** Area of one opening without frame (glazing, or the door). */
  area: number;
  frameArea: number;
  multiplier: number;
  zoneMultiplier: number;
  /** (area + frame) × multiplier × zone multiplier, like EnergyPlus' window-wall ratio. */
  totalArea: number;
  construction?: string;
  constructionId?: number;
  glazing?: SimpleGlazing;
  frame?: string;
  frameId?: number;
  /** The frame is named on a simplified Window or GlazedDoor, which EnergyPlus ignores. */
  frameIgnored?: boolean;
  shading: ShadingControlRef[];
  afn?: AfnSurfaceLink;
}

export interface WindowInventory {
  rows: WindowRow[];
  afn: { present: boolean; active: boolean; control?: string };
}

const OPENING_KINDS = new Set<string>(['window', 'glassdoor', 'door', 'tdd']);

/** Facing of an opening: cardinal for walls, Roof or Floor for tilted ones. */
export function facingOf(azimuth: number, tilt: number): Facing {
  if (tilt < 60) return 'Roof';
  if (tilt > 120) return 'Floor';
  return orientationOf(azimuth);
}

export function windowInventory(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
  afn: AfnModel,
): WindowInventory {
  const inventory: WindowInventory = {
    rows: [],
    afn: { present: afn.present, active: afn.active, control: afn.control },
  };
  if (!schema) return inventory;
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);
  const byName = (key: string) =>
    new Map(model.ofClass(key).map((o) => [(o.fields[0] ?? '').trim().toLowerCase(), o]));

  const constructions = byName('construction');
  const simpleGlazing = byName('windowmaterial:simpleglazingsystem');
  const frames = byName('windowproperty:frameanddivider');

  // Shading controls: 9.0+ lists the windows in WindowShadingControl; before,
  // each window names its WindowProperty:ShadingControl.
  const oldControls = byName('windowproperty:shadingcontrol');
  const controlRef = (obj: IdfObject): ShadingControlRef => {
    const r = reader(obj);
    return {
      id: obj.id,
      name: r.str('Name'),
      shadingType: r.str('Shading Type'),
      controlType: r.str('Shading Control Type'),
    };
  };
  const shadingOf = new Map<string, ShadingControlRef[]>();
  for (const obj of model.ofClass('windowshadingcontrol')) {
    const ref = controlRef(obj);
    for (const raw of reader(obj).from('Fenestration Surface 1 Name')) {
      const name = raw.trim().toLowerCase();
      if (!name) continue;
      shadingOf.set(name, [...(shadingOf.get(name) ?? []), ref]);
    }
  }

  const multipliers = zoneMultipliers(model, schema);
  const bases = new Map<string, Surface3D>();
  for (const s of geometry.surfaces) {
    if (!OPENING_KINDS.has(s.kind) && s.kind !== 'shading') bases.set(s.name.toLowerCase(), s);
  }

  for (const s of geometry.surfaces) {
    if (!OPENING_KINDS.has(s.kind)) continue;
    const obj = model.objects[s.id] as IdfObject;
    const r = reader(obj);
    const base = s.base ? bases.get(s.base.toLowerCase()) : undefined;

    let width: number | undefined;
    let height: number | undefined;
    if (s.vertices.length === 4) {
      const [ul, ll, lr] = s.vertices as [Vec3, Vec3, Vec3, Vec3];
      width = length(sub(lr, ll));
      height = length(sub(ul, ll));
    }
    let sill: number | undefined;
    let head: number | undefined;
    if (base && base.tilt > 60 && base.tilt < 120) {
      const floor = Math.min(...base.vertices.map((v) => v[2]));
      sill = Math.min(...s.vertices.map((v) => v[2])) - floor;
      head = Math.max(...s.vertices.map((v) => v[2])) - floor;
    }

    const construction = s.construction
      ? constructions.get(s.construction.toLowerCase())
      : undefined;
    let glazing: SimpleGlazing | undefined;
    if (construction) {
      const layers = reader(construction)
        .from('Outside Layer')
        .filter((v) => v.trim());
      const material =
        layers.length === 1
          ? simpleGlazing.get((layers[0] as string).trim().toLowerCase())
          : undefined;
      if (material) {
        const m = reader(material);
        glazing = {
          id: material.id,
          name: m.str('Name'),
          u: m.num('U-Factor'),
          shgc: m.num('Solar Heat Gain Coefficient'),
          vt: m.num('Visible Transmittance'),
        };
      }
    }

    const frameName = r.str('Frame and Divider Name');
    const frame = frameName ? frames.get(frameName.toLowerCase()) : undefined;

    const shading = [...(shadingOf.get(s.name.toLowerCase()) ?? [])];
    const oldName = r.str('Shading Control Name');
    const old = oldName ? oldControls.get(oldName.toLowerCase()) : undefined;
    if (old) shading.push(controlRef(old));

    const zoneMultiplier = multipliers.get(s.zone?.toLowerCase() ?? '') ?? 1;
    const frameArea = s.frameArea ?? 0;
    inventory.rows.push({
      id: s.id,
      name: s.name,
      className: obj.className,
      kind: s.kind as OpeningKind,
      zone: s.zone,
      base: s.base,
      baseId: base?.id,
      boundary: s.boundary,
      azimuth: s.azimuth,
      tilt: s.tilt,
      facing: facingOf(s.azimuth, s.tilt),
      width,
      height,
      sill,
      head,
      area: s.area,
      frameArea,
      multiplier: s.multiplier,
      zoneMultiplier,
      totalArea: (s.area + frameArea) * s.multiplier * zoneMultiplier,
      construction: s.construction,
      constructionId: construction?.id,
      glazing,
      frame: frame ? reader(frame).str('Name') : frameName || undefined,
      frameId: frame?.id,
      frameIgnored:
        Boolean(frameName) && obj.className.toLowerCase() !== 'fenestrationsurface:detailed',
      shading,
      afn: afn.surfaces.get(s.name.toLowerCase()),
    });
  }
  return inventory;
}
