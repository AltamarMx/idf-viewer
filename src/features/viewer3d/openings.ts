/**
 * The open part of operable AirflowNetwork openings in the 3D view: each
 * window gets a frame (width along its bottom edge, height up its face, as seen
 * from outside) and the open part is drawn in it, just in front of the glass.
 */
import {
  type OpeningShape,
  type OpeningState,
  type OpeningsView,
  openPart,
  stateAt,
} from '../../core/airflow/openings3d';
import type { SurfaceView } from '../../core/session';
import type { Vec3 } from './explode';

export const OPENING_COLORS: Record<Exclude<OpeningState, 'closed'>, string> = {
  open: '#2f9e44',
  may: '#f59f00',
};

/** In front of the glass, which sits 0.02 m in front of its wall. */
const FRONT = 0.04;

export interface Frame {
  origin: Vec3;
  /** Unit vectors: along the width (to the right from outside), up the face, and outward. */
  u: Vec3;
  v: Vec3;
  n: Vec3;
  width: number;
  height: number;
}

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Frame of a window: the box of its vertices in its own plane, centered, with
 * the width and height EnergyPlus uses (the equivalent rectangle of a window
 * that is not a rectangle).
 */
export function windowFrame(s: SurfaceView, width?: number, height?: number): Frame {
  const n = unit(s.normal);
  // Width runs horizontally; on a flat surface, along x.
  const u: Vec3 = Math.abs(n[2]) < 0.999 ? unit([-n[1], n[0], 0]) : [1, 0, 0];
  const v = unit(cross(n, u));
  const p = s.positions;
  const p0: Vec3 = [p[0] as number, p[1] as number, p[2] as number];
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const d: Vec3 = [
      (p[i] as number) - p0[0],
      (p[i + 1] as number) - p0[1],
      (p[i + 2] as number) - p0[2],
    ];
    const a = dot(d, u);
    const b = dot(d, v);
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
    b0 = Math.min(b0, b);
    b1 = Math.max(b1, b);
  }
  const w = width ?? a1 - a0;
  const h = height ?? b1 - b0;
  const center = add(add(p0, u, (a0 + a1) / 2), v, (b0 + b1) / 2);
  return { origin: add(add(center, u, -w / 2), v, -h / 2), u, v, n, width: w, height: h };
}

export interface OpeningQuad {
  /** Index of the window in GeometryView.surfaces. */
  surface: number;
  corners: [Vec3, Vec3, Vec3, Vec3];
  color: string;
}

/** Corners of the open part of an opening at a factor, or null when closed. */
export function openCorners(
  shape: OpeningShape,
  frame: Frame,
  factor: number,
): [Vec3, Vec3, Vec3, Vec3] | null {
  const part = openPart({ ...shape, width: frame.width, height: frame.height }, factor);
  if (!part) return null;
  const { origin, u, v, n } = frame;
  const front = add(origin, n, FRONT);
  if (part.kind === 'rect') {
    const at = (x: number, y: number) => add(add(front, u, x), v, y);
    return [at(part.x0, part.y0), at(part.x1, part.y0), at(part.x1, part.y1), at(part.x0, part.y1)];
  }
  // The sash turns about the axis: the part above it moves out, the part below in.
  const angle = (part.angle * Math.PI) / 180;
  const up = add([0, 0, 0], v, Math.cos(angle));
  const tilted = add(up, n, Math.sin(angle));
  const at = (x: number, y: number) =>
    add(add(add(front, u, x), v, part.axis), tilted, y - part.axis);
  return [at(0, 0), at(frame.width, 0), at(frame.width, frame.height), at(0, frame.height)];
}

/**
 * Quads to draw at a timestep (null: each opening at its maximum opening
 * factor), with their state; surfaces not drawn are skipped.
 */
export function openingQuads(
  view: OpeningsView,
  surfaces: SurfaceView[],
  step: number | null,
  visible: (index: number) => boolean,
  offsets: Vec3[],
): { quads: OpeningQuad[]; counts: Record<OpeningState, number> } {
  const index = new Map(surfaces.map((s, i) => [s.id, i]));
  const counts: Record<OpeningState, number> = { open: 0, may: 0, closed: 0 };
  const quads: OpeningQuad[] = [];
  for (const shape of view.openings) {
    const i = index.get(shape.surfaceId);
    const state = stateAt(shape, view, step);
    counts[state]++;
    if (i === undefined || state === 'closed' || !visible(i)) continue;
    const s = surfaces[i] as SurfaceView;
    const corners = openCorners(shape, windowFrame(s, shape.width, shape.height), shape.maxFactor);
    if (!corners) continue;
    const o = offsets[i] ?? [0, 0, 0];
    quads.push({
      surface: i,
      corners: corners.map((c) => add(c, o)) as OpeningQuad['corners'],
      color: OPENING_COLORS[state],
    });
  }
  return { quads, counts };
}
