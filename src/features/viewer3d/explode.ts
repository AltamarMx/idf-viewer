/**
 * Exploded view (C7) and interzone pairs: how far each surface moves when the
 * floors or the zones are pulled apart, and the lines that join each surface
 * with the surface it names as its other side. Coordinates are those of the
 * scene (relative to the center of the model).
 */
import type { SurfaceView } from '../../core/session';

export type Vec3 = [number, number, number];
export type ExplodeMode = 'floors' | 'zones';

const BASE_KINDS = new Set(['wall', 'floor', 'roof', 'ceiling']);

/** Average of the vertices of each surface. */
export function surfaceCenters(surfaces: SurfaceView[]): Vec3[] {
  return surfaces.map((s) => {
    const n = s.positions.length / 3;
    const c: Vec3 = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      for (let k = 0; k < 3; k++) c[k] = (c[k] as number) + (s.positions[v * 3 + k] as number) / n;
    }
    return c;
  });
}

/** Area-weighted center of the base surfaces of each zone (lowercase name). */
export function zoneCenters(surfaces: SurfaceView[], centers: Vec3[]): Map<string, Vec3> {
  const sums = new Map<string, { area: number; sum: Vec3 }>();
  surfaces.forEach((s, i) => {
    if (!s.zone || !BASE_KINDS.has(s.kind)) return;
    const key = s.zone.toLowerCase();
    const entry = sums.get(key) ?? { area: 0, sum: [0, 0, 0] };
    const w = s.area > 0 ? s.area : 1;
    const c = centers[i] as Vec3;
    entry.sum = [entry.sum[0] + c[0] * w, entry.sum[1] + c[1] * w, entry.sum[2] + c[2] * w];
    entry.area += w;
    sums.set(key, entry);
  });
  return new Map(
    [...sums].map(([key, { area, sum }]) => [key, [sum[0] / area, sum[1] / area, sum[2] / area]]),
  );
}

/**
 * Offset of each surface.
 * - floors: each floor level goes up by its order (0, 1, 2…) × `amount` meters;
 * - zones: each zone moves away from the center of the model by `amount` × the
 *   distance from that center to the zone's own center (0.5 = half as far again).
 * Windows, doors and zone shading follow their zone; site and building shading
 * do not move.
 */
export function explodeOffsets(
  surfaces: SurfaceView[],
  mode: ExplodeMode,
  amount: number,
  zones: Map<string, Vec3>,
  levels: number[],
): Vec3[] {
  return surfaces.map((s) => offsetOf(s.zone, s.level, mode, amount, zones, levels));
}

export function offsetOf(
  zone: string | undefined,
  level: number | undefined,
  mode: ExplodeMode,
  amount: number,
  zones: Map<string, Vec3>,
  levels: number[],
): Vec3 {
  if (!amount) return [0, 0, 0];
  if (mode === 'floors') {
    const i = level === undefined ? -1 : levels.indexOf(level);
    return [0, 0, i > 0 ? i * amount : 0];
  }
  const c = zone ? zones.get(zone.toLowerCase()) : undefined;
  return c ? [c[0] * amount, c[1] * amount, c[2] * amount] : [0, 0, 0];
}

export type PairStatus = 'ok' | 'one-way' | 'missing';

export interface PairLine {
  /** Index of the surface that names the other side. */
  from: number;
  /** Index of the named surface; undefined when it does not exist. */
  to?: number;
  status: PairStatus;
}

/**
 * Interzone pairs: surfaces with an outside boundary "Surface" and the surface
 * they name. "ok" when the named surface names this one back (one line per
 * pair), "one-way" when it names another one, "missing" when it does not exist.
 * A surface that names itself (an internal partition) is left out, and so is a
 * window or door without its own other side.
 */
export function pairLines(surfaces: SurfaceView[]): PairLine[] {
  const byName = new Map<string, number>();
  surfaces.forEach((s, i) => {
    if (s.kind !== 'shading') byName.set(s.name.toLowerCase(), i);
  });
  const lines: PairLine[] = [];
  surfaces.forEach((s, i) => {
    if (s.kind === 'shading' || s.boundary !== 'Surface' || !s.boundaryObject) return;
    const target = s.boundaryObject.toLowerCase();
    if (target === s.name.toLowerCase()) return;
    const j = byName.get(target);
    if (j === undefined) {
      lines.push({ from: i, status: 'missing' });
      return;
    }
    const back = surfaces[j]?.boundaryObject?.toLowerCase() === s.name.toLowerCase();
    if (back && j < i) return; // drawn once, from the first of the pair
    lines.push({ from: i, to: j, status: back ? 'ok' : 'one-way' });
  });
  return lines;
}
