/**
 * Geometry checks (C8, H5): the warnings EnergyPlus writes about surfaces and
 * zones when it reads the geometry, with its tolerances (checked with
 * EnergyPlus 26.2, see PLAN.md, phase 2c notes), plus one the viewer adds.
 *
 * Vertices are cleaned first as EnergyPlus does: a vertex closer than 1 cm to
 * the next one is dropped, then vertices in a straight line with their
 * neighbors. The other checks use the cleaned vertices.
 */
import type { Severity } from '../validation/problems';
import type { Surface3D, ZoneGeometry } from './build';
import {
  azimuthTilt,
  cross,
  dot,
  isEnclosed,
  length,
  newell,
  normalize,
  polygonArea,
  sub,
  type Vec3,
} from './polygon';

export type GeometryCheck =
  | 'degenerate'
  | 'coincident'
  | 'collinear'
  | 'smallArea'
  | 'nonPlanar'
  | 'nonPlanarSevere'
  | 'upsideDown'
  | 'notOriented'
  | 'interzoneArea'
  | 'interzoneAzimuth'
  | 'interzoneTilt'
  | 'subsurfaceOutside'
  | 'subsurfaceOffPlane'
  | 'notEnclosed';

/** Checks EnergyPlus does not do; the rest reproduce an EnergyPlus warning or error. */
export const VIEWER_ONLY_CHECKS: ReadonlySet<GeometryCheck> = new Set(['subsurfaceOffPlane']);

export interface GeometryIssue {
  check: GeometryCheck;
  severity: Severity;
  objectId: number;
  /** Surfaces involved (one, or both sides of an interzone pair), or the zone. */
  names: string[];
  /** Ids of the surfaces to highlight in the 3D view. */
  surfaceIds: number[];
  message: string;
}

/** Distance under which EnergyPlus drops a vertex as coincident with the next one. */
export const COINCIDENT_DISTANCE = 0.01;
/** Area under which EnergyPlus warns about a very small surface (m²). */
export const SMALL_AREA = 0.001;
/** Out-of-plane distance for "possible" (warning) and "suspected" (error) non-planar surfaces. */
export const NON_PLANAR = { warning: 0.0001, error: 0.01 };
/** Relative area difference and angle (degrees) EnergyPlus allows between interzone sides. */
export const INTERZONE = { area: 0.02, angle: 1 };
/** Distance from the base surface plane above which the viewer reports a window. */
export const OFF_PLANE = 0.01;

const BASE_KINDS = new Set(['wall', 'floor', 'roof', 'ceiling']);
const fmt = (n: number, digits = 2) => String(Number(n.toFixed(digits)));

interface Cleaned {
  vertices: Vec3[];
  coincident: number;
  collinear: number;
  degenerate: boolean;
}

/** Vertices after EnergyPlus drops coincident and collinear ones. */
export function cleanVertices(input: Vec3[]): Cleaned {
  const vs = [...input];
  let coincident = 0;
  let degenerate = false;
  for (let i = 0; i < vs.length && vs.length > 0; ) {
    const a = vs[i] as Vec3;
    const b = vs[(i + 1) % vs.length] as Vec3;
    if (vs.length > 1 && length(sub(a, b)) < COINCIDENT_DISTANCE) {
      coincident++;
      if (vs.length <= 3) {
        degenerate = true;
        break;
      }
      vs.splice(i, 1);
    } else i++;
  }
  let collinear = 0;
  if (!degenerate) {
    for (let i = 0; i < vs.length && vs.length > 3; ) {
      const prev = vs[(i - 1 + vs.length) % vs.length] as Vec3;
      const v = vs[i] as Vec3;
      const next = vs[(i + 1) % vs.length] as Vec3;
      const a = sub(v, prev);
      const b = sub(next, v);
      const sine = length(cross(a, b)) / (length(a) * length(b) || 1);
      if (sine < 1e-5 && dot(a, b) > 0) {
        collinear++;
        vs.splice(i, 1);
      } else i++;
    }
    if (vs.length < 3) degenerate = true;
  }
  return { vertices: vs, coincident, collinear, degenerate };
}

/** Largest distance of the vertices to the plane EnergyPlus fits (Newell normal through their average). */
export function outOfPlane(vs: Vec3[]): number {
  if (vs.length < 4) return 0;
  const n = normalize(newell(vs));
  const c: Vec3 = [0, 0, 0];
  for (const v of vs)
    for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (v[k] as number) / vs.length;
  return Math.max(...vs.map((v) => Math.abs(dot(n, sub(v, c)))));
}

/** 2D coordinates of points in the plane of a polygon. */
function planeBasis(vs: Vec3[]) {
  const n = normalize(newell(vs));
  const origin = vs[0] as Vec3;
  let u = normalize(sub(vs[1] as Vec3, origin));
  if (length(u) === 0) u = [1, 0, 0];
  const v = cross(n, u);
  return {
    n,
    origin,
    to2d: (p: Vec3): [number, number] => {
      const d = sub(p, origin);
      return [dot(d, u), dot(d, v)];
    },
    distance: (p: Vec3) => dot(n, sub(p, origin)),
  };
}

/** Distance from a 2D point to a polygon's outline, negative inside. */
function signedDistance(p: [number, number], poly: [number, number][]): number {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as [number, number];
    const [xj, yj] = poly[j] as [number, number];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
      inside = !inside;
    const ex = xj - xi;
    const ey = yj - yi;
    const len2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - xi) * ex + (p[1] - yi) * ey) / len2));
    best = Math.min(best, Math.hypot(p[0] - (xi + t * ex), p[1] - (yi + t * ey)));
  }
  return inside ? -best : best;
}

/**
 * Polygons that close each zone, as EnergyPlus sees them: the zone's walls,
 * floors, roofs and ceilings, plus the other side of surfaces in other zones
 * whose boundary is "Zone" and names it (EnergyPlus makes that side), minus
 * interzone pairs with both sides in the zone itself (walls between spaces of
 * one zone), which cancel out. Upside-down roofs, ceilings and floors are
 * reversed, as EnergyPlus does before computing the volume.
 */
export function zonePolygons(
  surfaces: Surface3D[],
  vertices: (s: Surface3D) => Vec3[] = (s) => s.vertices,
): Map<string, { surfaces: Surface3D[]; polygons: Vec3[][] }> {
  const result = new Map<string, { surfaces: Surface3D[]; polygons: Vec3[][] }>();
  const entry = (zone: string) => {
    const key = zone.toLowerCase();
    let e = result.get(key);
    if (!e) {
      e = { surfaces: [], polygons: [] };
      result.set(key, e);
    }
    return e;
  };
  const byName = new Map(surfaces.map((s) => [s.name.toLowerCase(), s]));
  for (const s of surfaces) {
    if (!BASE_KINDS.has(s.kind) || !s.zone) continue;
    const partner = s.boundaryObject ? byName.get(s.boundaryObject.toLowerCase()) : undefined;
    if (
      partner &&
      partner !== s &&
      s.boundary?.toLowerCase() === 'surface' &&
      partner.zone?.toLowerCase() === s.zone.toLowerCase()
    )
      continue;
    const e = entry(s.zone);
    e.surfaces.push(s);
    const upsideDown =
      ((s.kind === 'roof' || s.kind === 'ceiling') && s.tilt > 90 + 1e-6) ||
      (s.kind === 'floor' && s.tilt < 90 - 1e-6);
    e.polygons.push(upsideDown ? [...vertices(s)].reverse() : vertices(s));
    const target = s.boundaryObject?.toLowerCase();
    if (s.boundary?.toLowerCase() === 'zone' && target && target !== s.zone.toLowerCase())
      entry(target).polygons.push([...vertices(s)].reverse());
  }
  return result;
}

const angleDifference = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function geometryChecks(surfaces: Surface3D[], zones: ZoneGeometry[]): GeometryIssue[] {
  const issues: GeometryIssue[] = [];
  const add = (
    check: GeometryCheck,
    severity: Severity,
    s: Surface3D | Surface3D[],
    message: string,
  ) => {
    const list = Array.isArray(s) ? s : [s];
    issues.push({
      check,
      severity,
      objectId: (list[0] as Surface3D).id,
      names: list.map((x) => x.name),
      surfaceIds: list.map((x) => x.id),
      message,
    });
  };

  const cleaned = new Map<Surface3D, Vec3[]>();
  for (const s of surfaces) {
    const c = cleanVertices(s.vertices);
    cleaned.set(s, c.vertices);
    if (s.kind === 'shading') continue;
    if (c.coincident)
      add(
        'coincident',
        'warning',
        s,
        `${s.name} has vertices less than 1 cm apart: EnergyPlus drops ${c.coincident === 1 ? 'one' : c.coincident}.`,
      );
    if (c.degenerate) {
      const area = polygonArea(s.vertices);
      if (area < SMALL_AREA)
        add(
          'smallArea',
          'warning',
          s,
          `${s.name} has a very small area (${area.toExponential(1)} m²; EnergyPlus warns under ${SMALL_AREA} m²).`,
        );
      add(
        'degenerate',
        'error',
        s,
        `${s.name} has fewer than 3 vertices once EnergyPlus drops those less than 1 cm apart: it is degenerate and should be deleted.`,
      );
      continue;
    }
    if (c.collinear)
      add(
        'collinear',
        'warning',
        s,
        `${s.name} has ${c.collinear === 1 ? 'a vertex' : `${c.collinear} vertices`} in a straight line with ${c.collinear === 1 ? 'its' : 'their'} neighbors: EnergyPlus removes ${c.collinear === 1 ? 'it' : 'them'}.`,
      );
    const area = polygonArea(c.vertices);
    if (area < SMALL_AREA)
      add(
        'smallArea',
        'warning',
        s,
        `${s.name} has a very small area (${area.toExponential(1)} m²; EnergyPlus warns under ${SMALL_AREA} m²).`,
      );
    const off = outOfPlane(c.vertices);
    if (off > NON_PLANAR.error)
      add(
        'nonPlanarSevere',
        'error',
        s,
        `${s.name} is not planar: a vertex is ${fmt(off * 1000, 1)} mm out of its plane (EnergyPlus: severe error over 10 mm).`,
      );
    else if (off > NON_PLANAR.warning)
      add(
        'nonPlanar',
        'warning',
        s,
        `${s.name} may not be planar: a vertex is ${fmt(off * 1000, 2)} mm out of its plane (EnergyPlus warns over 0.1 mm).`,
      );

    // Orientation of roofs, ceilings and floors.
    const { tilt } = azimuthTilt(c.vertices);
    const t = fmt(tilt, 1);
    if (s.kind === 'roof' || s.kind === 'ceiling') {
      if (tilt > 90 + 1e-6)
        add(
          'upsideDown',
          'warning',
          s,
          `${s.name} (${s.kind}) is upside down: tilt ${t}°, it should face up. EnergyPlus reverses its vertices.`,
        );
      else if (tilt > 80 + 1e-6)
        add(
          'notOriented',
          'warning',
          s,
          `${s.name} (${s.kind}) is not oriented correctly: tilt ${t}°, it should face up (EnergyPlus warns over 80°).`,
        );
    } else if (s.kind === 'floor') {
      if (tilt < 90 - 1e-6)
        add(
          'upsideDown',
          'warning',
          s,
          `${s.name} (floor) is upside down: tilt ${t}°, it should face down. EnergyPlus reverses its vertices.`,
        );
      else if (tilt < 158 + 1e-6)
        add(
          'notOriented',
          'warning',
          s,
          `${s.name} (floor) is not oriented correctly: tilt ${t}°, it should face down (EnergyPlus warns under 158°).`,
        );
    }
  }

  // Interzone pairs, once per pair.
  const byName = new Map(
    surfaces.filter((s) => s.kind !== 'shading').map((s) => [s.name.toLowerCase(), s]),
  );
  const seen = new Set<string>();
  for (const s of surfaces) {
    if (s.kind === 'shading' || !s.boundaryObject) continue;
    const other = byName.get(s.boundaryObject.toLowerCase());
    if (!other || other === s) continue;
    const key = [s.id, other.id].sort((a, b) => a - b).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const [first, second] = s.id <= other.id ? [s, other] : [other, s];
    const a1 = polygonArea(cleaned.get(first) ?? first.vertices);
    const a2 = polygonArea(cleaned.get(second) ?? second.vertices);
    if (Math.abs(a1 - a2) > INTERZONE.area * a1)
      add(
        'interzoneArea',
        'warning',
        [first, second],
        `Interzone surfaces ${first.name} (${fmt(a1)} m²) and ${second.name} (${fmt(a2)} m²) differ in area by more than 2%.`,
      );
    if (first.kind === 'wall' && second.kind === 'wall') {
      const o1 = azimuthTilt(cleaned.get(first) ?? first.vertices);
      const o2 = azimuthTilt(cleaned.get(second) ?? second.vertices);
      if (Math.abs(angleDifference(o1.azimuth, o2.azimuth) - 180) > INTERZONE.angle)
        add(
          'interzoneAzimuth',
          'warning',
          [first, second],
          `Interzone walls ${first.name} (azimuth ${fmt(o1.azimuth, 1)}°) and ${second.name} (${fmt(o2.azimuth, 1)}°) should face opposite ways.`,
        );
      if (Math.abs(o1.tilt + o2.tilt - 180) > INTERZONE.angle)
        add(
          'interzoneTilt',
          'warning',
          [first, second],
          `Interzone walls ${first.name} (tilt ${fmt(o1.tilt, 1)}°) and ${second.name} (${fmt(o2.tilt, 1)}°) do not have matching tilts.`,
        );
    }
  }

  // Windows and doors on their base surface.
  for (const s of surfaces) {
    if (BASE_KINDS.has(s.kind) || s.kind === 'shading' || !s.base) continue;
    const base = byName.get(s.base.toLowerCase());
    const baseVs = base && cleaned.get(base);
    if (!base || !baseVs || baseVs.length < 3) continue;
    const plane = planeBasis(baseVs);
    const outline = baseVs.map(plane.to2d);
    const own = cleaned.get(s) ?? s.vertices;
    const outside = Math.max(...own.map((v) => signedDistance(plane.to2d(v), outline)));
    if (outside > 0.001)
      add(
        'subsurfaceOutside',
        'warning',
        [s, base],
        `${s.name} goes ${fmt(outside)} m past the edge of its base surface ${base.name} (EnergyPlus: base surface does not surround subsurface).`,
      );
    const off = Math.max(...own.map((v) => Math.abs(plane.distance(v))));
    if (off > OFF_PLANE)
      add(
        'subsurfaceOffPlane',
        'warning',
        [s, base],
        `${s.name} is ${fmt(off)} m away from the plane of its base surface ${base.name}. EnergyPlus does not check this (viewer check).`,
      );
  }

  // Zones that are not enclosed.
  const closing = zonePolygons(surfaces, (s) => cleaned.get(s) ?? s.vertices);
  for (const zone of zones) {
    const e = closing.get(zone.name.toLowerCase());
    if (!e || e.surfaces.length === 0) continue;
    if (isEnclosed(e.polygons.filter((v) => v.length >= 3))) continue;
    issues.push({
      check: 'notEnclosed',
      severity: 'warning',
      objectId: zone.id,
      names: [zone.name],
      surfaceIds: e.surfaces.map((s) => s.id),
      message: `Zone ${zone.name} is not fully enclosed: some edge of its surfaces is not shared by exactly two surfaces. ${zone.volumeSource === 'input' ? 'Its volume is the one written in the Zone object.' : 'EnergyPlus then estimates its volume as floor area × ceiling height.'}`,
    });
  }
  return issues;
}
