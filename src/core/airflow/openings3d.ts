/**
 * The open part of each operable AirflowNetwork opening, for the 3D view (L2,
 * L5, L6): which part of the window is open at an opening factor, and when the
 * venting availability schedule lets it open.
 *
 * How EnergyPlus sizes the opening (AirflowNetwork Elements.cpp):
 * - DetailedOpening, non-pivoted: open width = width × width factor, open
 *   height = height × height factor, starting at height × start height factor
 *   from the bottom; the factors are interpolated between the opening factor
 *   sets. Where the width sits along the window does not change the flow; the
 *   viewer draws it from the left edge, as in the opening card.
 * - DetailedOpening, horizontally pivoted: the sash turns about a horizontal
 *   axis at the pivot height (m from the bottom) by opening factor × 90°.
 * - SimpleOpening: open width = width × opening factor, full height.
 * - HorizontalOpening: open area = area × opening factor (× a slope term); the
 *   viewer draws it as a strip of width × opening factor, like SimpleOpening.
 */
import { interpolateSet, type OpeningFactorSet } from './afn';
import type { RuleKind } from './rules';

export type OperableType = 'detailedopening' | 'simpleopening' | 'horizontalopening';

/** Always available (no schedule) or the schedule cannot be evaluated. */
export const ALWAYS = -1;
export const NOT_EVALUABLE = -2;

export interface OpeningShape {
  /** Id of the window or door (the surface listed in the network). */
  surfaceId: number;
  name: string;
  zone?: string;
  component: string;
  type: OperableType;
  controlMode: string;
  ruleKind: RuleKind;
  /** Window/Door Opening Factor: the most it opens. */
  maxFactor: number;
  /** Width and height EnergyPlus uses (the equivalent rectangle if it is not one). */
  width?: number;
  height?: number;
  sets?: OpeningFactorSet[];
  /** Horizontally pivoted DetailedOpening: height of the pivot axis from the bottom (m). */
  pivotHeight?: number;
  schedule?: string;
  /** Index in OpeningsView.schedules, ALWAYS or NOT_EVALUABLE. */
  availability: number;
  occupantControl?: string;
}

export interface OpeningsView {
  timestepsPerHour: number;
  /** Each availability schedule: 1 at the timesteps it is above zero. */
  schedules: { name: string; available: Uint8Array }[];
  openings: OpeningShape[];
}

/**
 * Open part in the window's own frame: x from the left edge and y from the
 * bottom (m), as seen from outside; or a sash turned about a horizontal axis.
 */
export type OpenPart =
  | { kind: 'rect'; x0: number; x1: number; y0: number; y1: number }
  | { kind: 'pivot'; angle: number; axis: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** What is open at an opening factor (0 or less: nothing). */
export function openPart(o: OpeningShape, factor: number): OpenPart | null {
  const { width, height } = o;
  if (!(factor > 0) || width === undefined || height === undefined) return null;
  if (o.type === 'detailedopening') {
    if (o.pivotHeight !== undefined)
      return {
        kind: 'pivot',
        angle: Math.min(1, factor) * 90,
        axis: Math.min(height, Math.max(0, o.pivotHeight)),
      };
    const set = interpolateSet(o.sets ?? [], factor);
    if (!set) return null;
    const y0 = clamp01(set.startHeightFactor) * height;
    const x1 = clamp01(set.widthFactor) * width;
    const y1 = Math.min(height, y0 + clamp01(set.heightFactor) * height);
    return x1 > 0 && y1 > y0 ? { kind: 'rect', x0: 0, x1, y0, y1 } : null;
  }
  return { kind: 'rect', x0: 0, x1: clamp01(factor) * width, y0: 0, y1: height };
}

/** Open area (m²) of a part; a pivoted sash has no single area. */
export function partArea(part: OpenPart | null): number | undefined {
  if (!part) return 0;
  return part.kind === 'rect' ? (part.x1 - part.x0) * (part.y1 - part.y0) : undefined;
}

/**
 * State of an opening at a timestep:
 * - closed: its schedule does not let it open (or NoVent);
 * - open: Constant control, open to its maximum (what EnergyPlus does);
 * - may: it may open up to its maximum, depending on the simulation.
 */
export type OpeningState = 'closed' | 'open' | 'may';

export function stateAt(o: OpeningShape, view: OpeningsView, step: number | null): OpeningState {
  if (o.ruleKind === 'closed') return 'closed';
  if (step !== null && o.availability >= 0) {
    const available = view.schedules[o.availability]?.available[step];
    if (!available) return 'closed';
  }
  if (step === null) return o.ruleKind === 'constant' ? 'open' : 'may';
  if (o.availability === NOT_EVALUABLE) return 'may';
  return o.ruleKind === 'constant' && !o.occupantControl ? 'open' : 'may';
}
