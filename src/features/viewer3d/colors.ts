/**
 * Surface colors for the 3D view (C4, C12).
 *
 * Boundary conditions and surface types use OpenStudio's palette, taken from
 * OpenStudio's src/utilities/geometry/ThreeJS.cpp (the colors of its 3D view and
 * FloorspaceJS). "Zone" and "Space" boundaries do not exist in OpenStudio; they
 * get a light green close to "Surface".
 */
import type { SurfaceView } from '../../core/session';

export type ColorMode = 'boundary' | 'type' | 'zone' | 'construction';

export const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'boundary', label: 'Boundary condition' },
  { id: 'type', label: 'Surface type' },
  { id: 'zone', label: 'Zone' },
  { id: 'construction', label: 'Construction' },
];

export interface Category {
  key: string;
  label: string;
  color: string;
}

const rgb = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

/** OpenStudio boundary colors, in legend order. */
export const BOUNDARY_COLORS: Category[] = [
  { key: 'Outdoors:SunWind', label: 'Outdoors · sun and wind exposed', color: rgb(68, 119, 161) },
  { key: 'Outdoors:Sun', label: 'Outdoors · sun exposed only', color: rgb(40, 204, 204) },
  { key: 'Outdoors:Wind', label: 'Outdoors · wind exposed only', color: rgb(9, 159, 162) },
  { key: 'Outdoors', label: 'Outdoors · no sun, no wind', color: rgb(163, 204, 204) },
  { key: 'Surface', label: 'Surface (interzone)', color: rgb(0, 153, 0) },
  { key: 'Zone', label: 'Zone (interzone)', color: rgb(102, 204, 102) },
  { key: 'Space', label: 'Space (interzone)', color: rgb(140, 214, 140) },
  { key: 'Adiabatic', label: 'Adiabatic', color: rgb(255, 0, 0) },
  { key: 'Ground', label: 'Ground', color: rgb(204, 183, 122) },
  { key: 'GroundFCfactorMethod', label: 'Ground (F/C-factor)', color: rgb(153, 122, 30) },
  { key: 'Foundation', label: 'Foundation (Kiva)', color: rgb(117, 30, 122) },
  {
    key: 'GroundSlabPreprocessorAverage',
    label: 'Slab preprocessor · average',
    color: rgb(255, 191, 0),
  },
  {
    key: 'GroundSlabPreprocessorCore',
    label: 'Slab preprocessor · core',
    color: rgb(255, 182, 50),
  },
  {
    key: 'GroundSlabPreprocessorPerimeter',
    label: 'Slab preprocessor · perimeter',
    color: rgb(255, 178, 101),
  },
  {
    key: 'GroundBasementPreprocessorAverageWall',
    label: 'Basement preprocessor · average wall',
    color: rgb(204, 51, 0),
  },
  {
    key: 'GroundBasementPreprocessorAverageFloor',
    label: 'Basement preprocessor · average floor',
    color: rgb(204, 81, 40),
  },
  {
    key: 'GroundBasementPreprocessorUpperWall',
    label: 'Basement preprocessor · upper wall',
    color: rgb(204, 112, 81),
  },
  {
    key: 'GroundBasementPreprocessorLowerWall',
    label: 'Basement preprocessor · lower wall',
    color: rgb(204, 173, 163),
  },
  { key: 'OtherSideCoefficients', label: 'Other side coefficients', color: rgb(63, 63, 63) },
  { key: 'OtherSideConditionsModel', label: 'Other side conditions model', color: rgb(153, 0, 76) },
];

/** OpenStudio surface type colors. */
export const TYPE_COLORS: Record<string, Category> = {
  floor: { key: 'floor', label: 'Floor', color: rgb(128, 128, 128) },
  wall: { key: 'wall', label: 'Wall', color: rgb(204, 178, 102) },
  roof: { key: 'roof', label: 'Roof / ceiling', color: rgb(153, 76, 76) },
  window: { key: 'window', label: 'Window / glass door', color: rgb(102, 178, 204) },
  door: { key: 'door', label: 'Door', color: rgb(153, 133, 76) },
  site: { key: 'site', label: 'Site shading', color: rgb(75, 124, 149) },
  building: { key: 'building', label: 'Building shading', color: rgb(113, 76, 153) },
  zone: { key: 'zone', label: 'Zone shading', color: rgb(76, 110, 178) },
};

const UNKNOWN: Category = { key: 'unknown', label: 'Unknown', color: '#ffffff' };
const NONE_COLOR = '#9aa3ab';

export const isGlazed = (s: SurfaceView) =>
  s.kind === 'window' || s.kind === 'glassdoor' || s.kind === 'tdd';

function typeCategory(s: SurfaceView): Category {
  if (s.kind === 'shading') return TYPE_COLORS[s.shading ?? 'zone'] as Category;
  if (s.kind === 'ceiling') return TYPE_COLORS.roof as Category;
  if (isGlazed(s)) return TYPE_COLORS.window as Category;
  return TYPE_COLORS[s.kind] ?? UNKNOWN;
}

export function boundaryKey(s: SurfaceView): string {
  if (s.boundary === 'Outdoors') {
    if (s.sunExposed && s.windExposed) return 'Outdoors:SunWind';
    if (s.sunExposed) return 'Outdoors:Sun';
    if (s.windExposed) return 'Outdoors:Wind';
    return 'Outdoors';
  }
  return s.boundary ?? 'unknown';
}

const BOUNDARY_BY_KEY = new Map(BOUNDARY_COLORS.map((c) => [c.key, c]));

/** Distinct colors for zones and constructions (golden angle hues). */
function paletteColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 55%, ${index % 2 ? 62 : 52}%)`;
}

/** Category of each surface for a color mode, plus the legend in display order. */
export function categorize(
  surfaces: SurfaceView[],
  mode: ColorMode,
): { of: Category[]; legend: Category[] } {
  if (mode === 'boundary' || mode === 'type') {
    const of = surfaces.map((s) => {
      if (mode === 'type' || s.kind === 'shading') return typeCategory(s);
      return (
        BOUNDARY_BY_KEY.get(boundaryKey(s)) ?? {
          ...UNKNOWN,
          key: boundaryKey(s),
          label: s.boundary ?? 'Unknown',
        }
      );
    });
    const order = [...BOUNDARY_COLORS.map((c) => c.key), ...Object.keys(TYPE_COLORS)];
    const legend = [...new Map(of.map((c) => [c.key, c])).values()].sort(
      (a, b) => (order.indexOf(a.key) + 1 || 999) - (order.indexOf(b.key) + 1 || 999),
    );
    return { of, legend };
  }
  const nameOf = (s: SurfaceView) =>
    mode === 'zone' ? s.zone : s.kind === 'shading' ? undefined : s.construction;
  const names = [...new Set(surfaces.map(nameOf).filter((v): v is string => Boolean(v)))].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
  const byName = new Map(
    names.map((n, i) => [
      n.toLowerCase(),
      { key: n.toLowerCase(), label: n, color: paletteColor(i) },
    ]),
  );
  const none: Category = {
    key: '(none)',
    label: mode === 'zone' ? 'No zone (site or building shading)' : 'No construction (shading)',
    color: NONE_COLOR,
  };
  const of = surfaces.map((s) => byName.get(nameOf(s)?.toLowerCase() ?? '') ?? none);
  const legend = [...byName.values()];
  if (of.includes(none)) legend.push(none);
  return { of, legend };
}
