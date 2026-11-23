/**
 * Wind pressure coefficients of the AirflowNetwork external nodes and the site
 * wind profile (L9). Reads the 8.0–8.7 syntax (external node → WindPressure-
 * CoefficientValues) and the 8.8+ one (values, a curve or a table, with the
 * symmetric and relative angle options), and the tables of 8.x
 * (Table:OneIndependentVariable) and 9.2+ (Table:Lookup).
 */
import type { GeometryResult, Surface3D } from '../geometry/build';
import type { IdfModel } from '../model/model';
import { FieldReader, toNumber } from '../model/reader';
import { type Facing, facingOf } from '../openings/windows';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import type { AfnModel } from './afn';

export interface CpSource {
  name: string;
  id?: number;
  className?: string;
  kind: 'values' | 'table' | 'curve' | 'missing' | 'unsupported';
  /** Wind angle (deg) and Cp as entered, for values and tables. */
  points: [number, number][];
  /** Cp every 5° from 0 to 360 as the node uses it (symmetry applied); empty when it cannot be drawn. */
  curve: [number, number][];
  /** WindPressureCoefficientArray of the values. */
  array?: { name: string; id?: number };
  notes: string[];
}

export interface WindNodeSurface {
  name: string;
  id?: number;
  zone?: string;
  azimuth: number;
  tilt: number;
  facing: Facing;
  /** Height of the centroid, used with "OpeningHeight". */
  height: number;
}

export interface WindNode {
  id: number;
  name: string;
  height: number;
  symmetric: boolean;
  angleType: 'Absolute' | 'Relative';
  cp: CpSource;
  surfaces: WindNodeSurface[];
  /** Local wind speed at the node height over the weather file wind speed. */
  speedRatio: number;
  warnings: string[];
}

export interface ProfileValue {
  value: number;
  /** Where the value comes from. */
  from: string;
  id?: number;
}

export interface WindSite {
  terrain: string;
  buildingId?: number;
  exponent: ProfileValue;
  boundaryLayer: ProfileValue;
  station: { height: ProfileValue; exponent: ProfileValue; boundaryLayer: ProfileValue };
  /** (δmet / zmet)^αmet: wind speed at the top of the boundary layer over the weather file wind. */
  stationFactor: number;
  /** Local wind speed over the weather file wind, by height (m). */
  profile: [number, number][];
}

export interface WindView {
  site: WindSite;
  afn: boolean;
  /** Cp come from the external nodes ("Input"). */
  cpInput: boolean;
  heightSelection?: string;
  nodes: WindNode[];
}

/** Wind speed profile by terrain (Engineering Reference, local wind speed). */
export const TERRAIN_PROFILE: Record<string, { exponent: number; boundaryLayer: number }> = {
  country: { exponent: 0.14, boundaryLayer: 270 },
  suburbs: { exponent: 0.22, boundaryLayer: 370 },
  city: { exponent: 0.33, boundaryLayer: 460 },
  ocean: { exponent: 0.1, boundaryLayer: 210 },
  urban: { exponent: 0.22, boundaryLayer: 370 },
};

/** Local wind speed over the weather file wind speed at height z. */
export function speedRatio(site: WindSite, z: number): number {
  if (z <= 0) return 0;
  return site.stationFactor * (z / site.boundaryLayer.value) ** site.exponent.value;
}

export function windView(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
  afn: AfnModel,
): WindView {
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema?.classes[obj.className.toLowerCase()]);
  const site = windSite(model, reader);
  const control = model.ofClass('airflownetwork:simulationcontrol')[0];
  const cr = control ? reader(control) : undefined;
  const cpInput = cr?.strOr('Wind Pressure Coefficient Type').toLowerCase() === 'input';
  const view: WindView = {
    site,
    afn: Boolean(control),
    cpInput,
    heightSelection: cr?.strOr('Height Selection for Local Wind Pressure Calculation') || undefined,
    nodes: [],
  };

  const surfaces = new Map<string, Surface3D>();
  for (const s of geometry.surfaces)
    if (s.kind !== 'shading') surfaces.set(s.name.toLowerCase(), s);
  const users = new Map<string, WindNodeSurface[]>();
  for (const link of afn.surfaces.values()) {
    if (link.viaPartner || !link.externalNode) continue;
    const s = surfaces.get(link.surface.toLowerCase());
    if (!s) continue;
    const zs = s.vertices.map((v) => v[2]);
    const list = users.get(link.externalNode.toLowerCase()) ?? [];
    list.push({
      name: s.name,
      id: s.id,
      zone: s.zone,
      azimuth: s.azimuth,
      tilt: s.tilt,
      facing: facingOf(s.azimuth, s.tilt),
      height: zs.reduce((a, b) => a + b, 0) / Math.max(1, zs.length),
    });
    users.set(link.externalNode.toLowerCase(), list);
  }

  // 8.0–8.7: the array of directions is named on the simulation control too.
  const controlArray = cr?.str('AirflowNetwork Wind Pressure Coefficient Array Name') || undefined;

  for (const obj of model.ofClass('airflownetwork:multizone:externalnode')) {
    const r = reader(obj);
    const name = r.str('Name');
    const cpField = r.find(/^Wind Pressure Coefficient (Curve|Values Object) Name$/);
    const symmetric = r.has('Symmetric Wind Pressure Coefficient Curve')
      ? r.strOr('Symmetric Wind Pressure Coefficient Curve').toLowerCase() === 'yes'
      : false;
    const angleType = r.has('Wind Angle Type')
      ? r.strOr('Wind Angle Type').toLowerCase() === 'relative'
        ? 'Relative'
        : 'Absolute'
      : 'Absolute';
    const height = r.numOr('External Node Height', 0);
    const nodeSurfaces = users.get(name.toLowerCase()) ?? [];
    const warnings: string[] = [];
    const cp = readCp(model, reader, cpField ? r.str(cpField) : '', symmetric, controlArray);
    // Absolute Cp: the wind that hits a facade straight on comes from the
    // direction it faces, so that is where its Cp should be highest.
    if (angleType === 'Absolute' && cp.curve.length > 0) {
      const peak = cp.curve.reduce((best, p) => (p[1] > best[1] ? p : best));
      for (const s of nodeSurfaces) {
        if (s.tilt < 5 || s.tilt > 175) continue;
        if (angleBetween(peak[0], s.azimuth) > 45)
          warnings.push(
            `${s.name} faces ${Math.round(s.azimuth)}°${s.facing === 'Roof' ? ' (a roof)' : ''}, but this node's highest Cp is for wind from ${peak[0]}°.`,
          );
      }
    }
    if (angleType === 'Relative' && nodeSurfaces.length > 1) {
      const first = nodeSurfaces[0] as WindNodeSurface;
      if (nodeSurfaces.some((s) => angleBetween(s.azimuth, first.azimuth) > 5))
        warnings.push(
          'The angle is relative to the facade, but the surfaces that use this node face different directions.',
        );
    }
    view.nodes.push({
      id: obj.id,
      name,
      height,
      symmetric,
      angleType,
      cp,
      surfaces: nodeSurfaces,
      speedRatio: speedRatio(site, height),
      warnings,
    });
  }

  const top = Math.max(
    10,
    site.station.height.value,
    ...view.nodes.map((n) => n.height),
    ...geometry.surfaces.flatMap((s) => s.vertices.map((v) => v[2])),
  );
  // Finer near the ground, where the profile changes fastest.
  const step = niceStep(top / 20);
  const heights = [0, step / 20, step / 10, step / 4, step / 2];
  for (let z = step; z <= top * 1.1 + 1e-9; z += step) heights.push(z);
  for (const z of heights) site.profile.push([round(z, 3), round(speedRatio(site, z), 4)]);
  return view;
}

function windSite(model: IdfModel, reader: (obj: IdfObject) => FieldReader): WindSite {
  const building = model.ofClass('building')[0];
  const br = building ? reader(building) : undefined;
  const terrain = br?.strOr('Terrain') || 'Suburbs';
  const t = TERRAIN_PROFILE[terrain.toLowerCase()] ?? (TERRAIN_PROFILE.suburbs as never);
  const fromTerrain = `Terrain ${terrain}`;
  const site: WindSite = {
    terrain,
    buildingId: building?.id,
    exponent: { value: t.exponent, from: fromTerrain, id: building?.id },
    boundaryLayer: { value: t.boundaryLayer, from: fromTerrain, id: building?.id },
    station: {
      height: { value: 10, from: 'default' },
      exponent: { value: 0.14, from: 'default' },
      boundaryLayer: { value: 270, from: 'default' },
    },
    stationFactor: 1,
    profile: [],
  };

  // Site:HeightVariation replaces the terrain values with the fields it gives;
  // a blank field before the last one given takes the IDD default.
  const hv = model.ofClass('site:heightvariation')[0];
  if (hv) {
    const r = reader(hv);
    const given = lastGiven(hv);
    const apply = (target: ProfileValue, field: string) => {
      const i = r.indexOf(field);
      if (i === undefined || i >= given) return;
      target.value = r.numOr(field, target.value);
      target.from = 'Site:HeightVariation';
      target.id = hv.id;
    };
    apply(site.exponent, 'Wind Speed Profile Exponent');
    apply(site.boundaryLayer, 'Wind Speed Profile Boundary Layer Thickness');
  }

  const ws = model.ofClass('site:weatherstation')[0];
  if (ws) {
    const r = reader(ws);
    const set = (target: ProfileValue, field: string) => {
      target.value = r.numOr(field, target.value);
      target.from = 'Site:WeatherStation';
      target.id = ws.id;
    };
    set(site.station.height, 'Wind Sensor Height Above Ground');
    set(site.station.exponent, 'Wind Speed Profile Exponent');
    set(site.station.boundaryLayer, 'Wind Speed Profile Boundary Layer Thickness');
  }
  const st = site.station;
  site.stationFactor =
    st.height.value > 0 ? (st.boundaryLayer.value / st.height.value) ** st.exponent.value : 1;
  return site;
}

/** Number of fields up to the last one that is not blank (EnergyPlus' NumNums). */
function lastGiven(obj: IdfObject): number {
  let n = obj.fields.length;
  while (n > 0 && !(obj.fields[n - 1] ?? '').trim()) n--;
  return n;
}

const CURVES = [
  'curve:linear',
  'curve:quadratic',
  'curve:cubic',
  'curve:quartic',
  'curve:exponent',
];

function readCp(
  model: IdfModel,
  reader: (obj: IdfObject) => FieldReader,
  name: string,
  symmetric: boolean,
  controlArray: string | undefined,
): CpSource {
  const source: CpSource = { name, kind: 'missing', points: [], curve: [], notes: [] };
  if (!name) return source;
  const byName = (key: string, n: string) =>
    model.ofClass(key).find((o) => (o.fields[0] ?? '').trim().toLowerCase() === n.toLowerCase());
  const sample = (f: (angle: number) => number | undefined) => {
    for (let a = 0; a <= 360; a += 5) {
      const x = symmetric && a > 180 ? 360 - a : a;
      const y = f(x);
      if (y !== undefined && Number.isFinite(y)) source.curve.push([a, round(y, 4)]);
    }
  };

  const values = byName('airflownetwork:multizone:windpressurecoefficientvalues', name);
  if (values) {
    const r = reader(values);
    const arrayName =
      r.str('AirflowNetwork:MultiZone:WindPressureCoefficientArray Name') || controlArray || '';
    const array = byName('airflownetwork:multizone:windpressurecoefficientarray', arrayName);
    Object.assign(source, { id: values.id, className: values.className, kind: 'values' });
    source.array = { name: arrayName, id: array?.id };
    const numbers = (list: string[]) =>
      list.map((v) => toNumber(v.trim())).filter((v): v is number => v !== undefined);
    const dirs = array ? numbers(array.fields.slice(1)) : [];
    const cps = numbers(r.from('Wind Pressure Coefficient Value 1'));
    if (!array) source.notes.push(`WindPressureCoefficientArray ${arrayName} does not exist.`);
    else if (dirs.length !== cps.length)
      source.notes.push(
        `${dirs.length} wind directions but ${cps.length} Cp values: EnergyPlus needs the same number.`,
      );
    const n = Math.min(dirs.length, cps.length);
    for (let i = 0; i < n; i++) source.points.push([dirs[i] as number, cps[i] as number]);
    if (n >= 2) sample((a) => periodicLinear(source.points, a));
    return source;
  }

  // 8.x table of one variable: pairs of X and output after the header fields.
  const table1 = byName('table:oneindependentvariable', name);
  if (table1) {
    const r = reader(table1);
    Object.assign(source, { id: table1.id, className: table1.className, kind: 'table' });
    const pairs = r.from('X Value #1').map((v) => toNumber(v.trim()));
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const x = pairs[i];
      const y = pairs[i + 1];
      if (x !== undefined && y !== undefined) source.points.push([x, y]);
    }
    const ref = r.num('Normalization Reference');
    if (ref) source.points = source.points.map(([x, y]) => [x, y / ref]);
    const method = r.strOr('Interpolation Method');
    if (method && method.toLowerCase() !== 'linearinterpolationoftable')
      source.notes.push(
        `Interpolation Method is ${method}: the chart joins the points with straight lines.`,
      );
    clampedTable(source, r.num('Minimum Table Output'), r.num('Maximum Table Output'), sample);
    return source;
  }

  // 9.2+ lookup table with one independent variable.
  const lookup = byName('table:lookup', name);
  if (lookup) {
    const r = reader(lookup);
    Object.assign(source, { id: lookup.id, className: lookup.className, kind: 'table' });
    const listName = r.str('Independent Variable List Name');
    const list = byName('table:independentvariablelist', listName);
    const varNames = list
      ? list.fields
          .slice(1)
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
    const variable =
      varNames.length === 1
        ? byName('table:independentvariable', varNames[0] as string)
        : undefined;
    if (r.str('External File Name') || (variable && reader(variable).str('External File Name'))) {
      source.kind = 'unsupported';
      source.notes.push(
        'The table reads its values from an external file, which the viewer cannot open.',
      );
      return source;
    }
    if (!variable) {
      source.kind = 'unsupported';
      source.notes.push(
        varNames.length > 1
          ? 'The table has more than one independent variable.'
          : `Independent variable list ${listName} is missing or empty.`,
      );
      return source;
    }
    const vr = reader(variable);
    const xs = vr
      .from('Value 1')
      .map((v) => toNumber(v.trim()))
      .filter((v): v is number => v !== undefined);
    let ys = r
      .from('Output Value 1')
      .map((v) => toNumber(v.trim()))
      .filter((v): v is number => v !== undefined);
    if (r.strOr('Normalization Method').toLowerCase() === 'divisoronly') {
      const d = r.num('Normalization Divisor');
      if (d) ys = ys.map((y) => y / d);
    }
    if (xs.length !== ys.length)
      source.notes.push(`${xs.length} angles but ${ys.length} output values.`);
    for (let i = 0; i < Math.min(xs.length, ys.length); i++)
      source.points.push([xs[i] as number, ys[i] as number]);
    const method = vr.strOr('Interpolation Method');
    if (method && method.toLowerCase() !== 'linear')
      source.notes.push(
        `Interpolation Method is ${method}: the chart joins the points with straight lines.`,
      );
    clampedTable(source, r.num('Minimum Output'), r.num('Maximum Output'), sample);
    return source;
  }

  for (const key of CURVES) {
    const curve = byName(key, name);
    if (!curve) continue;
    const r = reader(curve);
    Object.assign(source, { id: curve.id, className: curve.className, kind: 'curve' });
    const c = r
      .from('Coefficient1 Constant')
      .slice(0, key === 'curve:exponent' ? 3 : 5)
      .map((v) => toNumber(v.trim()) ?? 0);
    const minX = r.num('Minimum Value of x');
    const maxX = r.num('Maximum Value of x');
    const minY = r.num('Minimum Curve Output');
    const maxY = r.num('Maximum Curve Output');
    const degree = {
      'curve:linear': 1,
      'curve:quadratic': 2,
      'curve:cubic': 3,
      'curve:quartic': 4,
    }[key];
    sample((angle) => {
      let x = angle;
      if (minX !== undefined) x = Math.max(minX, x);
      if (maxX !== undefined) x = Math.min(maxX, x);
      let y =
        degree === undefined
          ? (c[0] ?? 0) + (c[1] ?? 0) * x ** (c[2] ?? 1)
          : c.slice(0, degree + 1).reduce((sum, k, i) => sum + k * x ** i, 0);
      if (minY !== undefined) y = Math.max(minY, y);
      if (maxY !== undefined) y = Math.min(maxY, y);
      return y;
    });
    return source;
  }

  // Another kind of curve: named but not drawn.
  const other = model.objects.find(
    (o) =>
      /^(curve|table):/i.test(o.className) &&
      (o.fields[0] ?? '').trim().toLowerCase() === name.toLowerCase(),
  );
  if (other) {
    Object.assign(source, { id: other.id, className: other.className, kind: 'unsupported' });
    source.notes.push(`The viewer does not draw ${other.className}.`);
  } else {
    source.notes.push(`${name} does not exist.`);
  }
  return source;
}

function clampedTable(
  source: CpSource,
  min: number | undefined,
  max: number | undefined,
  sample: (f: (angle: number) => number | undefined) => void,
) {
  const pts = [...source.points].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return;
  sample((a) => {
    let y = linear(pts, a);
    if (y === undefined) return undefined;
    if (min !== undefined) y = Math.max(min, y);
    if (max !== undefined) y = Math.min(max, y);
    return y;
  });
}

/** Linear interpolation inside the points; the end values beyond them. */
function linear(pts: [number, number][], x: number): number | undefined {
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return undefined;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i] as [number, number];
    const [x0, y0] = pts[i - 1] as [number, number];
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

/**
 * Cp between the wind directions of WindPressureCoefficientValues: linear, and
 * from the last direction back to the first one at 360°.
 */
export function periodicLinear(pts: [number, number][], angle: number): number | undefined {
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  if (!first) return undefined;
  const last = sorted[sorted.length - 1] as [number, number];
  if (last[0] < 360) sorted.push([first[0] + 360, first[1]]);
  const a = angle < first[0] ? angle + 360 : angle;
  return linear(sorted, a);
}

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function niceStep(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

function round(x: number, digits: number): number {
  return Number(x.toFixed(digits));
}
