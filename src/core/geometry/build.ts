/**
 * Geometry of all surfaces (C1, C2, C6) in EnergyPlus world coordinates, following
 * the same rules as EnergyPlus (checked against tests/oracles):
 *
 * - GlobalGeometryRules: starting corner and vertex order are normalized to
 *   "upper-left corner, counterclockwise", like EnergyPlus reports them.
 * - Relative coordinates: zone rotation and origin, then building North Axis.
 * - World coordinates: vertices as entered; North Axis and zone origins are ignored.
 * - Simplified (rectangular) surfaces use the "Rectangular Surface Coordinate
 *   System" for their starting corner; their azimuth is rotated only when the
 *   main coordinate system is relative.
 * - Shading:Site never rotates; Shading:Building rotates with the building.
 */
import type { IdfModel } from '../model/model';
import { FieldReader, toNumber } from '../model/reader';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import {
  add,
  azimuthTilt,
  isEnclosed,
  length,
  normalize,
  polygonArea,
  scale,
  signedVolume,
  sub,
  toRad,
  unitNormal,
  type Vec3,
} from './polygon';

export type SurfaceKind =
  | 'wall'
  | 'floor'
  | 'roof'
  | 'ceiling'
  | 'window'
  | 'door'
  | 'glassdoor'
  | 'tdd'
  | 'shading';
export type ShadingType = 'site' | 'building' | 'zone';

export interface Surface3D {
  /** Id of the IDF object (fins produce two surfaces with the same id). */
  id: number;
  name: string;
  className: string;
  kind: SurfaceKind;
  shading?: ShadingType;
  zone?: string;
  space?: string;
  construction?: string;
  /** Base surface of a window/door, or of zone shading. */
  base?: string;
  boundary?: string;
  boundaryObject?: string;
  sunExposed?: boolean;
  windExposed?: boolean;
  multiplier: number;
  /** Area of the window frame (WindowProperty:FrameAndDivider), outside the glazed area. */
  frameArea?: number;
  /** World coordinates, upper-left corner first, counterclockwise seen from outside. */
  vertices: Vec3[];
  normal: Vec3;
  area: number;
  azimuth: number;
  tilt: number;
}

export interface ZoneGeometry {
  id: number;
  name: string;
  multiplier: number;
  partOfTotalArea: boolean;
  floorArea: number;
  floorAreaSource: 'input' | 'surfaces';
  volume: number;
  /** "default": EnergyPlus uses 10 m³ when the volume cannot be calculated. */
  volumeSource: 'input' | 'enclosed' | 'estimated' | 'default';
  enclosed: boolean;
  surfaceCount: number;
}

export interface GeometryRules {
  startCorner: 'upperleftcorner' | 'lowerleftcorner' | 'upperrightcorner' | 'lowerrightcorner';
  clockwise: boolean;
  relative: boolean;
  rectRelative: boolean;
  northAxis: number;
}

export interface GeometryWarning {
  objectId: number;
  message: string;
}

export interface GeometryResult {
  rules: GeometryRules;
  surfaces: Surface3D[];
  zones: ZoneGeometry[];
  warnings: GeometryWarning[];
}

const BOUNDARIES = [
  'Adiabatic',
  'Surface',
  'Zone',
  'Space',
  'Outdoors',
  'Foundation',
  'Ground',
  'GroundFCfactorMethod',
  'OtherSideCoefficients',
  'OtherSideConditionsModel',
  'GroundSlabPreprocessorAverage',
  'GroundSlabPreprocessorCore',
  'GroundSlabPreprocessorPerimeter',
  'GroundBasementPreprocessorAverageWall',
  'GroundBasementPreprocessorAverageFloor',
  'GroundBasementPreprocessorUpperWall',
  'GroundBasementPreprocessorLowerWall',
];
const BOUNDARY_BY_LOWER = new Map(BOUNDARIES.map((b) => [b.toLowerCase(), b]));

export function canonicalBoundary(raw: string): string {
  return BOUNDARY_BY_LOWER.get(raw.trim().toLowerCase()) ?? raw.trim();
}

interface RectBase {
  kind: SurfaceKind;
  boundary: string | 'interzone';
  exposed: boolean;
  dimension: 'Height' | 'Width';
}

const RECT_BASE: Record<string, RectBase> = {
  'wall:exterior': { kind: 'wall', boundary: 'Outdoors', exposed: true, dimension: 'Height' },
  'wall:adiabatic': { kind: 'wall', boundary: 'Adiabatic', exposed: false, dimension: 'Height' },
  'wall:underground': { kind: 'wall', boundary: 'Ground', exposed: false, dimension: 'Height' },
  'wall:interzone': { kind: 'wall', boundary: 'interzone', exposed: false, dimension: 'Height' },
  roof: { kind: 'roof', boundary: 'Outdoors', exposed: true, dimension: 'Width' },
  'ceiling:adiabatic': {
    kind: 'ceiling',
    boundary: 'Adiabatic',
    exposed: false,
    dimension: 'Width',
  },
  'ceiling:interzone': {
    kind: 'ceiling',
    boundary: 'interzone',
    exposed: false,
    dimension: 'Width',
  },
  'floor:groundcontact': { kind: 'floor', boundary: 'Ground', exposed: false, dimension: 'Width' },
  'floor:adiabatic': { kind: 'floor', boundary: 'Adiabatic', exposed: false, dimension: 'Width' },
  'floor:interzone': { kind: 'floor', boundary: 'interzone', exposed: false, dimension: 'Width' },
};

const RECT_SUB: Record<string, SurfaceKind> = {
  window: 'window',
  door: 'door',
  glazeddoor: 'glassdoor',
  'window:interzone': 'window',
  'door:interzone': 'door',
  'glazeddoor:interzone': 'glassdoor',
};

const DETAILED_BASE = [
  'buildingsurface:detailed',
  'wall:detailed',
  'roofceiling:detailed',
  'floor:detailed',
];

export const GEOMETRY_CLASSES = new Set([
  ...DETAILED_BASE,
  ...Object.keys(RECT_BASE),
  ...Object.keys(RECT_SUB),
  'fenestrationsurface:detailed',
  'shading:site:detailed',
  'shading:building:detailed',
  'shading:zone:detailed',
  'shading:site',
  'shading:building',
  'shading:overhang',
  'shading:overhang:projection',
  'shading:fin',
  'shading:fin:projection',
]);

interface ZoneFrame {
  id: number;
  name: string;
  relNorth: number;
  origin: Vec3;
}

/** Clockwise rotation in plan, the way EnergyPlus applies north angles. */
function rotate(v: Vec3, deg: number): Vec3 {
  if (!deg) return v;
  const c = Math.cos(toRad(deg));
  const s = Math.sin(toRad(deg));
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c, v[2]];
}

/** Rectangle from its lower-left corner, as EnergyPlus' MakeRectangularVertices. */
export function makeRectangle(
  llc: Vec3,
  length: number,
  height: number,
  azimuth: number,
  tilt: number,
  offsetX = 0,
  offsetY = 0,
): Vec3[] {
  const ca = Math.cos(toRad(azimuth));
  const sa = Math.sin(toRad(azimuth));
  const ct = Math.cos(toRad(tilt));
  const st = Math.sin(toRad(tilt));
  const xx = [offsetX, offsetX, offsetX + length, offsetX + length];
  const yy = [offsetY + height, offsetY, offsetY, offsetY + height];
  return xx.map((x, i) => {
    const y = yy[i] as number;
    return [llc[0] - x * ca - y * ct * sa, llc[1] + x * sa - y * ct * ca, llc[2] + y * st];
  });
}

function readRules(model: IdfModel, schema: Schema): GeometryRules {
  const ggr = model.ofClass('globalgeometryrules')[0];
  const r = ggr ? new FieldReader(ggr, schema.classes.globalgeometryrules) : undefined;
  const start = (r?.str('Starting Vertex Position') || 'UpperLeftCorner').toLowerCase();
  const coords = (r?.str('Coordinate System') || 'Relative').toLowerCase();
  const rect = (r?.str('Rectangular Surface Coordinate System') || 'Relative').toLowerCase();
  const building = model.ofClass('building')[0];
  const north = building ? new FieldReader(building, schema.classes.building).num('North Axis') : 0;
  return {
    startCorner: ([
      'upperleftcorner',
      'lowerleftcorner',
      'upperrightcorner',
      'lowerrightcorner',
    ].includes(start)
      ? start
      : 'upperleftcorner') as GeometryRules['startCorner'],
    clockwise: (r?.str('Vertex Entry Direction') ?? '').toLowerCase() === 'clockwise',
    relative: coords === 'relative',
    rectRelative: rect === 'relative',
    northAxis: north ?? 0,
  };
}

/** Reorders entered vertices to "upper-left corner first, counterclockwise". */
export function normalizeOrder(
  vs: Vec3[],
  rules: Pick<GeometryRules, 'startCorner' | 'clockwise'>,
) {
  const n = vs.length;
  if (n < 3) return vs;
  const ccw = rules.clockwise ? [vs[0] as Vec3, ...vs.slice(1).reverse()] : vs;
  const shift = {
    upperleftcorner: 0,
    lowerleftcorner: n - 1,
    lowerrightcorner: n - 2,
    upperrightcorner: 1,
  }[rules.startCorner];
  return shift ? [...ccw.slice(shift), ...ccw.slice(0, shift)] : ccw;
}

function parseVertices(values: string[], count: number | undefined): Vec3[] | null {
  const vs: Vec3[] = [];
  for (let i = 0; i + 2 < values.length; i += 3) {
    const x = toNumber(values[i] ?? '');
    const y = toNumber(values[i + 1] ?? '');
    const z = toNumber(values[i + 2] ?? '');
    if (x === undefined || y === undefined || z === undefined) {
      if (!values[i] && !values[i + 1] && !values[i + 2]) break; // trailing blank vertex
      return null;
    }
    vs.push([x, y, z]);
  }
  return count !== undefined && count >= 3 && count < vs.length ? vs.slice(0, count) : vs;
}

export function buildGeometry(model: IdfModel, schema: Schema | undefined): GeometryResult {
  const warnings: GeometryWarning[] = [];
  const surfaces: Surface3D[] = [];
  if (!schema) {
    return {
      rules: {
        startCorner: 'upperleftcorner',
        clockwise: false,
        relative: true,
        rectRelative: true,
        northAxis: 0,
      },
      surfaces,
      zones: [],
      warnings,
    };
  }
  const rules = readRules(model, schema);
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);

  const zones = new Map<string, ZoneFrame>();
  for (const obj of model.ofClass('zone')) {
    const r = reader(obj);
    zones.set(r.str('Name').toLowerCase(), {
      id: obj.id,
      name: r.str('Name'),
      relNorth: r.num('Direction of Relative North') ?? 0,
      origin: [r.num('X Origin') ?? 0, r.num('Y Origin') ?? 0, r.num('Z Origin') ?? 0],
    });
  }

  const zoneToWorld = (v: Vec3, zone: ZoneFrame | undefined): Vec3 => {
    const local = rotate(v, zone?.relNorth ?? 0);
    const o = zone?.origin ?? [0, 0, 0];
    return rotate([local[0] + o[0], local[1] + o[1], local[2] + o[2]], rules.northAxis);
  };

  const finish = (s: Omit<Surface3D, 'normal' | 'area' | 'azimuth' | 'tilt'>): Surface3D => {
    const { azimuth, tilt } = azimuthTilt(s.vertices);
    return { ...s, normal: unitNormal(s.vertices), area: polygonArea(s.vertices), azimuth, tilt };
  };

  const detailedVertices = (obj: IdfObject, r: FieldReader): Vec3[] | null => {
    const vs = parseVertices(r.from('Vertex 1 X-coordinate'), r.num('Number of Vertices'));
    if (!vs || vs.length < 3) {
      warnings.push({ objectId: obj.id, message: 'Surface has fewer than 3 valid vertices.' });
      return null;
    }
    return normalizeOrder(vs, rules);
  };

  // 1. Base heat transfer surfaces.
  const baseByName = new Map<string, Surface3D>();
  const zoneNames = new Set(zones.keys());
  const pendingInterzone: Surface3D[] = [];

  for (const key of DETAILED_BASE) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const raw = detailedVertices(obj, r);
      if (!raw) continue;
      const zone = zones.get(r.str('Zone Name').toLowerCase());
      const vertices = rules.relative ? raw.map((v) => zoneToWorld(v, zone)) : raw;
      const boundary = canonicalBoundary(r.str('Outside Boundary Condition'));
      let kind: SurfaceKind;
      if (key === 'buildingsurface:detailed') {
        const type = r.str('Surface Type').toLowerCase();
        kind = (['wall', 'floor', 'roof', 'ceiling'].includes(type) ? type : 'wall') as SurfaceKind;
      } else if (key === 'roofceiling:detailed') {
        kind = boundary === 'Outdoors' ? 'roof' : 'ceiling';
      } else {
        kind = key === 'wall:detailed' ? 'wall' : 'floor';
      }
      const surface = finish({
        id: obj.id,
        name: r.str('Name'),
        className: obj.className,
        kind,
        zone: zone?.name ?? (r.str('Zone Name') || undefined),
        space: r.str('Space Name') || undefined,
        construction: r.str('Construction Name') || undefined,
        boundary,
        boundaryObject: r.str('Outside Boundary Condition Object') || undefined,
        sunExposed: r.str('Sun Exposure').toLowerCase() !== 'nosun',
        windExposed: r.str('Wind Exposure').toLowerCase() !== 'nowind',
        multiplier: 1,
        vertices,
      });
      surfaces.push(surface);
      baseByName.set(surface.name.toLowerCase(), surface);
    }
  }

  for (const [key, spec] of Object.entries(RECT_BASE)) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const zone = zones.get(r.str('Zone Name').toLowerCase());
      const start: Vec3 = [
        r.num('Starting X Coordinate') ?? 0,
        r.num('Starting Y Coordinate') ?? 0,
        r.num('Starting Z Coordinate') ?? 0,
      ];
      const llc = rules.rectRelative ? zoneToWorld(start, zone) : start;
      const azimuth =
        r.numOr('Azimuth Angle', 0) +
        (rules.relative ? rules.northAxis + (zone?.relNorth ?? 0) : 0);
      const tilt = r.numOr(
        'Tilt Angle',
        spec.kind === 'floor' ? 180 : spec.kind === 'wall' ? 90 : 0,
      );
      const vertices = makeRectangle(
        llc,
        r.num('Length') ?? 0,
        r.num(spec.dimension) ?? 0,
        azimuth,
        tilt,
      );
      const surface = finish({
        id: obj.id,
        name: r.str('Name'),
        className: obj.className,
        kind: spec.kind,
        zone: zone?.name ?? (r.str('Zone Name') || undefined),
        space: r.str('Space Name') || undefined,
        construction: r.str('Construction Name') || undefined,
        boundary: spec.boundary === 'interzone' ? 'Surface' : spec.boundary,
        boundaryObject: r.str('Outside Boundary Condition Object') || undefined,
        sunExposed: spec.exposed,
        windExposed: spec.exposed,
        multiplier: 1,
        vertices,
      });
      if (spec.boundary === 'interzone') pendingInterzone.push(surface);
      surfaces.push(surface);
      baseByName.set(surface.name.toLowerCase(), surface);
    }
  }
  // Interzone simplified surfaces point to a surface, or to a zone.
  for (const s of pendingInterzone) {
    const target = s.boundaryObject?.toLowerCase() ?? '';
    if (!baseByName.has(target) && zoneNames.has(target)) s.boundary = 'Zone';
  }

  // 2. Windows and doors.
  const subByName = new Map<string, Surface3D>();
  const fromBase = (base: Surface3D | undefined) => ({
    zone: base?.zone,
    space: base?.space,
    boundary: base?.boundary,
    sunExposed: base?.sunExposed,
    windExposed: base?.windExposed,
  });

  for (const obj of model.ofClass('fenestrationsurface:detailed')) {
    const r = reader(obj);
    const raw = detailedVertices(obj, r);
    if (!raw) continue;
    const base = baseByName.get(r.str('Building Surface Name').toLowerCase());
    const zone = base?.zone ? zones.get(base.zone.toLowerCase()) : undefined;
    const vertices = rules.relative ? raw.map((v) => zoneToWorld(v, zone)) : raw;
    const type = r.str('Surface Type').toLowerCase();
    const kind: SurfaceKind =
      type === 'door'
        ? 'door'
        : type === 'glassdoor'
          ? 'glassdoor'
          : type.startsWith('tubular')
            ? 'tdd'
            : 'window';
    const surface = finish({
      id: obj.id,
      name: r.str('Name'),
      className: obj.className,
      kind,
      ...fromBase(base),
      construction: r.str('Construction Name') || undefined,
      base: base?.name ?? (r.str('Building Surface Name') || undefined),
      boundaryObject: r.str('Outside Boundary Condition Object') || undefined,
      multiplier: r.numOr('Multiplier', 1),
      vertices,
    });
    surfaces.push(surface);
    subByName.set(surface.name.toLowerCase(), surface);
  }

  for (const [key, kind] of Object.entries(RECT_SUB)) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const base = baseByName.get(r.str('Building Surface Name').toLowerCase());
      if (!base) {
        warnings.push({
          objectId: obj.id,
          message: 'Base surface not found; the window or door is not drawn.',
        });
        continue;
      }
      const vertices = makeRectangle(
        base.vertices[1] as Vec3,
        r.num('Length') ?? 0,
        r.num('Height') ?? 0,
        base.azimuth,
        base.tilt,
        r.num('Starting X Coordinate') ?? 0,
        r.num('Starting Z Coordinate') ?? 0,
      );
      const surface = finish({
        id: obj.id,
        name: r.str('Name'),
        className: obj.className,
        kind,
        ...fromBase(base),
        construction: r.str('Construction Name') || undefined,
        base: base.name,
        boundaryObject: r.str('Outside Boundary Condition Object') || undefined,
        multiplier: r.numOr('Multiplier', 1),
        vertices,
      });
      surfaces.push(surface);
      subByName.set(surface.name.toLowerCase(), surface);
    }
  }

  // Window frames add area around the glazing: (W + 2·fw)(H + 2·fw) − W·H.
  const frameWidth = new Map<string, number>();
  for (const obj of model.ofClass('windowproperty:frameanddivider')) {
    const r = reader(obj);
    frameWidth.set(r.str('Name').toLowerCase(), r.num('Frame Width') ?? 0);
  }
  for (const s of subByName.values()) {
    const obj = model.objects[s.id] as IdfObject;
    const fw = frameWidth.get(reader(obj).str('Frame and Divider Name').toLowerCase()) ?? 0;
    if (fw <= 0 || s.vertices.length < 3) continue;
    const w = length(sub(s.vertices[2] as Vec3, s.vertices[1] as Vec3));
    const h = w > 0 ? s.area / w : 0;
    s.frameArea = (w + 2 * fw) * (h + 2 * fw) - w * h;
  }

  // 3. Shading.
  const shading = (
    obj: IdfObject,
    name: string,
    type: ShadingType,
    vertices: Vec3[],
    base?: string,
    zone?: string,
  ) => {
    surfaces.push(
      finish({
        id: obj.id,
        name,
        className: obj.className,
        kind: 'shading',
        shading: type,
        base,
        zone,
        multiplier: 1,
        vertices,
      }),
    );
  };

  for (const obj of model.ofClass('shading:site:detailed')) {
    const r = reader(obj);
    const vs = detailedVertices(obj, r);
    if (vs) shading(obj, r.str('Name'), 'site', vs);
  }
  for (const obj of model.ofClass('shading:building:detailed')) {
    const r = reader(obj);
    const vs = detailedVertices(obj, r);
    if (vs)
      shading(
        obj,
        r.str('Name'),
        'building',
        rules.relative ? vs.map((v) => rotate(v, rules.northAxis)) : vs,
      );
  }
  for (const obj of model.ofClass('shading:zone:detailed')) {
    const r = reader(obj);
    const vs = detailedVertices(obj, r);
    if (!vs) continue;
    const base = baseByName.get(r.str('Base Surface Name').toLowerCase());
    const zone = base?.zone ? zones.get(base.zone.toLowerCase()) : undefined;
    shading(
      obj,
      r.str('Name'),
      'zone',
      rules.relative ? vs.map((v) => zoneToWorld(v, zone)) : vs,
      base?.name,
      base?.zone,
    );
  }
  for (const [key, type] of [
    ['shading:site', 'site'],
    ['shading:building', 'building'],
  ] as const) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const start: Vec3 = [
        r.num('Starting X Coordinate') ?? 0,
        r.num('Starting Y Coordinate') ?? 0,
        r.num('Starting Z Coordinate') ?? 0,
      ];
      const building = type === 'building';
      const llc = building && rules.rectRelative ? rotate(start, rules.northAxis) : start;
      const azimuth =
        r.numOr('Azimuth Angle', 0) + (building && rules.relative ? rules.northAxis : 0);
      const vs = makeRectangle(
        llc,
        r.num('Length') ?? 0,
        r.num('Height') ?? 0,
        azimuth,
        r.numOr('Tilt Angle', 90),
      );
      shading(obj, r.str('Name'), type, vs);
    }
  }

  // Overhangs and fins are built from their window or door.
  const opening = (obj: IdfObject, r: FieldReader) => {
    const w = subByName.get(r.str('Window or Door Name').toLowerCase());
    if (w?.vertices.length !== 4) {
      warnings.push({
        objectId: obj.id,
        message: 'Window or door not found (or not rectangular); shading is not drawn.',
      });
      return null;
    }
    const [ul, ll, lr] = w.vertices as [Vec3, Vec3, Vec3, Vec3];
    return {
      w,
      ul,
      ll,
      lr,
      u: normalize(sub(lr, ll)),
      up: normalize(sub(ul, ll)),
      n: w.normal,
      width: length(sub(lr, ll)),
      height: length(sub(ul, ll)),
    };
  };
  const baseZone = (w: Surface3D) => ({ base: w.base, zone: w.zone });

  for (const key of ['shading:overhang', 'shading:overhang:projection']) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const o = opening(obj, r);
      if (!o) continue;
      const tilt = toRad(r.numOr('Tilt Angle from Window/Door', 90));
      const left = r.num('Left extension from Window/Door Width') ?? 0;
      const right = r.num('Right extension from Window/Door Width') ?? 0;
      const depth =
        key === 'shading:overhang'
          ? (r.num('Depth') ?? 0)
          : (r.num('Depth as Fraction of Window/Door Height') ?? 0) * o.height;
      const innerLeft = add(
        add(o.ul, scale(o.up, r.num('Height above Window or Door') ?? 0)),
        scale(o.u, -left),
      );
      const innerRight = add(innerLeft, scale(o.u, o.width + left + right));
      const d = scale(add(scale(o.up, Math.cos(tilt)), scale(o.n, Math.sin(tilt))), depth);
      const { base, zone } = baseZone(o.w);
      shading(
        obj,
        r.str('Name'),
        'zone',
        [add(innerLeft, d), innerLeft, innerRight, add(innerRight, d)],
        base,
        zone,
      );
    }
  }

  for (const key of ['shading:fin', 'shading:fin:projection']) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const o = opening(obj, r);
      if (!o) continue;
      const name = r.str('Name');
      for (const side of ['Left', 'Right'] as const) {
        const extension = r.num(`${side} Extension from Window/Door`) ?? 0;
        const above = r.num(`${side} Distance Above Top of Window`) ?? 0;
        const below = r.num(`${side} Distance Below Bottom of Window`) ?? 0;
        const tilt = toRad(r.numOr(`${side} Tilt Angle from Window/Door`, 90));
        const depth =
          key === 'shading:fin'
            ? (r.num(`${side} Depth`) ?? 0)
            : (r.num(`${side} Depth as Fraction of Window/Door Width`) ?? 0) * o.width;
        const corner =
          side === 'Left' ? add(o.ll, scale(o.u, -extension)) : add(o.lr, scale(o.u, extension));
        const bottom = add(corner, scale(o.up, -below));
        const top = add(bottom, scale(o.up, o.height + above + below));
        const d = scale(add(scale(o.n, Math.sin(tilt)), scale(o.u, Math.cos(tilt))), depth);
        const { base, zone } = baseZone(o.w);
        shading(
          obj,
          `${name} ${side}`,
          'zone',
          [top, bottom, add(bottom, d), add(top, d)],
          base,
          zone,
        );
      }
    }
  }

  return { rules, surfaces, zones: zoneGeometry(model, schema, surfaces), warnings };
}

const BASE_KINDS = new Set<SurfaceKind>(['wall', 'floor', 'roof', 'ceiling']);

function zoneGeometry(model: IdfModel, schema: Schema, surfaces: Surface3D[]): ZoneGeometry[] {
  const byZone = new Map<string, Surface3D[]>();
  for (const s of surfaces) {
    if (!BASE_KINDS.has(s.kind) || !s.zone) continue;
    const key = s.zone.toLowerCase();
    const list = byZone.get(key) ?? [];
    list.push(s);
    byZone.set(key, list);
  }
  return model.ofClass('zone').map((obj) => {
    const r = new FieldReader(obj, schema.classes.zone);
    const name = r.str('Name');
    const list = byZone.get(name.toLowerCase()) ?? [];
    const floors = list.filter((s) => s.kind === 'floor').reduce((sum, s) => sum + s.area, 0);
    const inputArea = r.num('Floor Area');
    const floorArea = inputArea && inputArea > 0 ? inputArea : floors;
    const polygons = list.map((s) => s.vertices);
    const enclosed = isEnclosed(polygons);
    const inputVolume = r.num('Volume');
    let volume = 0;
    let volumeSource: ZoneGeometry['volumeSource'] = 'default';
    if (inputVolume && inputVolume > 0) {
      volume = inputVolume;
      volumeSource = 'input';
    } else if (enclosed) {
      volume = Math.abs(signedVolume(polygons));
      volumeSource = 'enclosed';
    } else if (list.length > 0) {
      const zs = polygons.flat().map((v) => v[2]);
      volume = floorArea * (Math.max(...zs) - Math.min(...zs));
      volumeSource = 'estimated';
    }
    if (volume <= 0) {
      volume = 10;
      volumeSource = 'default';
    }
    return {
      id: obj.id,
      name,
      multiplier: r.numOr('Multiplier', 1),
      partOfTotalArea: r.str('Part of Total Floor Area').toLowerCase() !== 'no',
      floorArea,
      floorAreaSource: inputArea && inputArea > 0 ? 'input' : 'surfaces',
      volume,
      volumeSource,
      enclosed,
      surfaceCount: list.length,
    };
  });
}
