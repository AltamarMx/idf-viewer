import earcut from 'earcut';

export type Vec3 = [number, number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};

const DEG = Math.PI / 180;
export const toRad = (deg: number) => deg * DEG;
export const toDeg = (rad: number) => rad / DEG;

/** Newell's vector: twice the area times the unit normal (counterclockwise = outward). */
export function newell(vs: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i] as Vec3;
    const b = vs[(i + 1) % vs.length] as Vec3;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [x, y, z];
}

export const polygonArea = (vs: Vec3[]): number => length(newell(vs)) / 2;
export const unitNormal = (vs: Vec3[]): Vec3 => normalize(newell(vs));

/** Normalizes an angle to [0, 360). */
export function wrapDegrees(deg: number): number {
  const r = deg % 360;
  const w = r < 0 ? r + 360 : r;
  return Math.abs(w - 360) < 1e-9 ? 0 : w;
}

/**
 * Azimuth (clockwise from north, +y) and tilt (from horizontal, 0 = facing up), as
 * EnergyPlus reports them. For horizontal surfaces the azimuth comes from the edge
 * between vertex 2 and vertex 3 (the "bottom" edge of a surface entered from its
 * upper-left corner).
 */
export function azimuthTilt(vs: Vec3[]): { azimuth: number; tilt: number } {
  const n = unitNormal(vs);
  const tilt = toDeg(Math.acos(Math.max(-1, Math.min(1, n[2]))));
  if (Math.hypot(n[0], n[1]) > 1e-5 || vs.length < 3) {
    return { azimuth: wrapDegrees(toDeg(Math.atan2(n[0], n[1]))), tilt };
  }
  const e = sub(vs[2] as Vec3, vs[1] as Vec3);
  return { azimuth: wrapDegrees(toDeg(Math.atan2(e[1], -e[0]))), tilt };
}

/** Triangle indices of a planar polygon, concave or not. */
export function triangulate(vs: Vec3[], normal: Vec3 = unitNormal(vs)): number[] {
  if (vs.length < 3) return [];
  if (vs.length === 3) return [0, 1, 2];
  // Project on the plane where the polygon is largest.
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  const [i, j] = az >= ax && az >= ay ? [0, 1] : ax >= ay ? [1, 2] : [2, 0];
  const flat: number[] = [];
  for (const v of vs) flat.push(v[i] as number, v[j] as number);
  const indices = earcut(flat);
  if (indices.length > 0) return indices;
  // Degenerate polygon: fall back to a fan so that it is still visible.
  const fan: number[] = [];
  for (let k = 1; k < vs.length - 1; k++) fan.push(0, k, k + 1);
  return fan;
}

/** Signed volume enclosed by polygons with outward normals (divergence theorem). */
export function signedVolume(polygons: Vec3[][]): number {
  let total = 0;
  for (const vs of polygons) {
    const a = vs[0];
    if (!a) continue;
    for (let k = 1; k < vs.length - 1; k++) {
      total += dot(a, cross(vs[k] as Vec3, vs[k + 1] as Vec3));
    }
  }
  return total / 6;
}

/** Distance under which EnergyPlus considers two points equal (1/2 inch). */
export const POINT_TOLERANCE = 0.0127;

/**
 * True when every edge of the polygons is shared by exactly two polygons, which
 * is how EnergyPlus decides that a zone is enclosed. Points closer than
 * POINT_TOLERANCE are the same point, and vertices lying on another polygon's
 * edge (T-junctions) split that edge first.
 */
export function isEnclosed(polygons: Vec3[][], tolerance = POINT_TOLERANCE): boolean {
  if (polygons.length < 4) return false;
  // Cluster points by distance.
  const reps: Vec3[] = [];
  const idOf = (v: Vec3): number => {
    for (let i = 0; i < reps.length; i++) {
      if (length(sub(v, reps[i] as Vec3)) < tolerance) return i;
    }
    reps.push(v);
    return reps.length - 1;
  };
  const ids = polygons.map((vs) => vs.map(idOf));

  const edges = new Map<string, number>();
  polygons.forEach((vs, p) => {
    const pid = ids[p] as number[];
    for (let i = 0; i < vs.length; i++) {
      const ia = pid[i] as number;
      const ib = pid[(i + 1) % vs.length] as number;
      if (ia === ib) continue;
      const a = reps[ia] as Vec3;
      const ab = sub(reps[ib] as Vec3, a);
      const len2 = dot(ab, ab);
      // Points strictly inside the edge, sorted along it.
      const inner: [number, number][] = [];
      reps.forEach((pnt, k) => {
        if (k === ia || k === ib) return;
        const t = dot(sub(pnt, a), ab) / len2;
        if (t <= 0 || t >= 1) return;
        if (length(sub(pnt, add(a, scale(ab, t)))) < tolerance) inner.push([t, k]);
      });
      inner.sort((x, y) => x[0] - y[0]);
      const chain = [ia, ...inner.map((x) => x[1]), ib];
      for (let k = 0; k < chain.length - 1; k++) {
        const x = chain[k] as number;
        const y = chain[k + 1] as number;
        const edge = x < y ? `${x}|${y}` : `${y}|${x}`;
        edges.set(edge, (edges.get(edge) ?? 0) + 1);
      }
    }
  });
  for (const count of edges.values()) if (count !== 2) return false;
  return edges.size > 0;
}
