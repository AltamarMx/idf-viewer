/**
 * Infiltration (L7) and ventilation without AirflowNetwork (L8), per zone.
 *
 * Objects with a design flow rate are resolved to their zones (Zone, ZoneList,
 * Space, SpaceList) and their flow is computed with the calculation method,
 * like EnergyPlus does for its design level:
 *   Flow/Zone              Design Flow Rate
 *   Flow/Area              flow per floor area × floor area
 *   Flow/ExteriorArea      flow per exterior surface area × exterior surface area
 *   Flow/ExteriorWallArea  flow per exterior surface area × exterior wall area
 *   Flow/Person            flow per person × design people
 *   AirChanges/Hour        ACH × volume / 3600
 * The flow EnergyPlus uses each hour is design × schedule × (A + B·|ΔT| + C·V +
 * D·V²), which depends on the weather; only the design value is shown.
 */

import type { GeometryResult } from '../geometry/build';
import type { LoadsResult } from '../loads/loads';
import { type DescribedField, describeField } from '../model/describe';
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import type { ReferenceIndex } from '../model/references';
import { TARGET_FIELDS, type Target, zoneTargets } from '../model/targets';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import type { AfnModel } from './afn';
import { AFN_COMPONENTS } from './afn';

export type FlowKind = 'infiltration' | 'ventilation' | 'windstack' | 'mixing' | 'crossmixing';

export type CoefficientModel = 'constant' | 'doe2' | 'blast' | 'custom';

export const COEFFICIENT_MODELS: Record<
  Exclude<CoefficientModel, 'custom'>,
  [number, number, number, number]
> = {
  constant: [1, 0, 0, 0],
  doe2: [0, 0, 0.224, 0],
  blast: [0.606, 0.03636, 0.1177, 0],
};

export interface FlowRow {
  id: number;
  name: string;
  className: string;
  kind: FlowKind;
  zone: string;
  space?: string;
  /** ZoneList or SpaceList the object was assigned through. */
  via?: string;
  /** Source zone of ZoneMixing / ZoneCrossMixing. */
  source?: string;
  method?: string;
  /** Design flow in m³/s, before schedule and weather coefficients. */
  design?: number;
  /** Design flow normalized by the zone (or space): air changes per hour, per floor and exterior area. */
  ach?: number;
  perFloor?: number;
  perExterior?: number;
  schedule?: DescribedField;
  coefficients?: { a: number; b: number; c: number; d: number; model: CoefficientModel };
  /** Other settings, in IDD order. */
  fields: DescribedField[];
  /** How EnergyPlus computes the flow when there is no design value. */
  note?: string;
}

export interface ZoneFlowSummary {
  name: string;
  zoneId: number;
  floorArea: number;
  volume: number;
  /** Gross area of outdoor-exposed base surfaces (walls, roofs, floors). */
  exteriorArea: number;
  exteriorWallArea: number;
  /** Glazed area of windows and glass doors on outdoor surfaces, with multipliers. */
  windowArea: number;
  people: number;
  infiltration: { design: number; ach: number; objects: number; weatherOnly: number };
  ventilation: { design: number; ach: number; objects: number };
  /** Opening area of ZoneVentilation:WindandStackOpenArea objects. */
  openArea: number;
  /** AirflowNetwork leakage of the zone (cracks and effective leakage areas). */
  afn: { inNetwork: boolean; leakage: { surface: string; component: string; label: string }[] };
}

export interface AirBalanceRow {
  id: number;
  name: string;
  zone: string;
  fields: DescribedField[];
}

export interface ChimneyRow {
  id: number;
  name: string;
  zone: string;
  fields: DescribedField[];
  inlets: { zone: string; distance?: number; ratio?: number; area?: number }[];
}

export interface ZoneFlows {
  zones: ZoneFlowSummary[];
  rows: FlowRow[];
  airBalance: AirBalanceRow[];
  chimneys: ChimneyRow[];
  warnings: { objectId: number; message: string }[];
}

const FLOW = {
  design: /^Design Flow Rate$/,
  perFloor: /^Flow (Rate )?per (Zone )?Floor Area$/,
  perExterior: /^Flow (Rate )?per Exterior Surface Area$/,
  perPerson: /^Flow Rate per Person$/,
  ach: /^Air Changes per Hour$/,
};

export function coefficientModel(a: number, b: number, c: number, d: number): CoefficientModel {
  const close = (x: number, y: number) => Math.abs(x - y) <= 1e-3 * Math.max(1, Math.abs(y));
  for (const [model, ref] of Object.entries(COEFFICIENT_MODELS)) {
    if (close(a, ref[0]) && close(b, ref[1]) && close(c, ref[2]) && close(d, ref[3]))
      return model as CoefficientModel;
  }
  return 'custom';
}

export function zoneFlows(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
  references: ReferenceIndex,
  loads: LoadsResult,
  afn: AfnModel,
): ZoneFlows {
  const result: ZoneFlows = { zones: [], rows: [], airBalance: [], chimneys: [], warnings: [] };
  if (!schema) return result;
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);
  const fieldOf = (obj: IdfObject, r: FieldReader, pattern: RegExp | string, label?: string) =>
    describeField(
      obj,
      r,
      references,
      typeof pattern === 'string' ? pattern : r.find(pattern),
      label,
    );
  const targets = zoneTargets(model, schema, geometry);

  // Zone areas used by the flow methods.
  const summaries = new Map<string, ZoneFlowSummary>();
  const people = new Map(loads.zones.map((z) => [z.name.toLowerCase(), z.people]));
  const afnZones = new Set(
    model
      .ofClass('airflownetwork:multizone:zone')
      .map((o) => reader(o).str('Zone Name').toLowerCase()),
  );
  for (const z of geometry.zones) {
    summaries.set(z.name.toLowerCase(), {
      name: z.name,
      zoneId: z.id,
      floorArea: z.floorArea,
      volume: z.volume,
      exteriorArea: 0,
      exteriorWallArea: 0,
      windowArea: 0,
      people: people.get(z.name.toLowerCase()) ?? 0,
      infiltration: { design: 0, ach: 0, objects: 0, weatherOnly: 0 },
      ventilation: { design: 0, ach: 0, objects: 0 },
      openArea: 0,
      afn: { inNetwork: afn.active && afnZones.has(z.name.toLowerCase()), leakage: [] },
    });
  }
  const bases = new Map(geometry.surfaces.map((s) => [s.name.toLowerCase(), s]));
  for (const s of geometry.surfaces) {
    const z = s.zone ? summaries.get(s.zone.toLowerCase()) : undefined;
    if (!z || s.boundary !== 'Outdoors') continue;
    if (s.kind === 'wall' || s.kind === 'roof' || s.kind === 'floor' || s.kind === 'ceiling') {
      z.exteriorArea += s.area;
      if (s.kind === 'wall') z.exteriorWallArea += s.area;
    } else if (
      (s.kind === 'window' || s.kind === 'glassdoor') &&
      s.base &&
      bases.has(s.base.toLowerCase())
    ) {
      z.windowArea += s.area * s.multiplier;
    }
  }
  for (const link of afn.surfaces.values()) {
    if (link.role !== 'leakage') continue;
    const s = bases.get(link.surface.toLowerCase());
    const z = s?.zone ? summaries.get(s.zone.toLowerCase()) : undefined;
    if (z && !link.viaPartner)
      z.afn.leakage.push({
        surface: link.surface,
        component: link.component,
        label: link.type === 'missing' ? 'not found' : AFN_COMPONENTS[link.type].label,
      });
  }

  const zoneOf = (t: Target) => summaries.get(t.zone.toLowerCase());
  const resolve = (obj: IdfObject, r: FieldReader): Target[] => {
    const fieldName = TARGET_FIELDS.map((p) => r.find(p)).find(Boolean);
    const name = fieldName ? r.str(fieldName) : '';
    const list = targets(name);
    if (list.length === 0)
      result.warnings.push({
        objectId: obj.id,
        message: `"${name}" is not a zone, space or list; the object is not counted.`,
      });
    return list;
  };

  /** Design flow (m³/s) of an object with a "Design Flow Rate Calculation Method". */
  const designFlow = (r: FieldReader, t: Target, method: string): number | undefined => {
    const z = zoneOf(t);
    const value = (p: RegExp) => {
      const name = r.find(p);
      return name ? r.num(name) : undefined;
    };
    switch (method.toLowerCase()) {
      case 'flow/zone':
      case 'flow/space':
        return value(FLOW.design);
      case 'flow/area': {
        const v = value(FLOW.perFloor);
        return v === undefined ? undefined : v * t.area;
      }
      case 'flow/exteriorarea': {
        const v = value(FLOW.perExterior);
        return v === undefined || !z ? undefined : v * z.exteriorArea;
      }
      case 'flow/exteriorwallarea': {
        const v = value(FLOW.perExterior);
        return v === undefined || !z ? undefined : v * z.exteriorWallArea;
      }
      case 'flow/person': {
        const v = value(FLOW.perPerson);
        return v === undefined || !z ? undefined : v * z.people;
      }
      case 'airchanges/hour': {
        const v = value(FLOW.ach);
        return v === undefined ? undefined : (v * t.volume) / 3600;
      }
      default:
        return undefined;
    }
  };

  const normalized = (t: Target, design: number | undefined) => {
    const z = zoneOf(t);
    if (design === undefined) return {};
    return {
      ach: t.volume > 0 ? (design * 3600) / t.volume : undefined,
      perFloor: t.area > 0 ? design / t.area : undefined,
      perExterior: z && z.exteriorArea > 0 && !t.space ? design / z.exteriorArea : undefined,
    };
  };

  const coefficients = (r: FieldReader) => {
    const a = r.numOr(r.find(/^Constant Term Coefficient$/) ?? '', 1);
    const b = r.numOr(r.find(/^Temperature Term Coefficient$/) ?? '', 0);
    const c = r.numOr(r.find(/^Velocity Term Coefficient$/) ?? '', 0);
    const d = r.numOr(r.find(/^Velocity Squared Term Coefficient$/) ?? '', 0);
    return { a, b, c, d, model: coefficientModel(a, b, c, d) };
  };

  const others = (obj: IdfObject, r: FieldReader, skip: RegExp) =>
    (r.cls?.fields ?? [])
      .map((f) => f.name)
      .filter((n) => !skip.test(n))
      .map((n) => fieldOf(obj, r, n))
      .filter((f): f is DescribedField => Boolean(f));

  // Infiltration with a design flow rate.
  const COMMON =
    /^(Name|Zone.*Name|Schedule Name|Design Flow Rate Calculation Method|Design Flow Rate|Flow (Rate )?per .*|Air Changes per Hour|.*Term Coefficient)$/;
  for (const [key, kind] of [
    ['zoneinfiltration:designflowrate', 'infiltration'],
    ['zoneventilation:designflowrate', 'ventilation'],
  ] as const) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const method = r.strOr(r.find(/Calculation Method$/) ?? '');
      for (const t of resolve(obj, r)) {
        const design = designFlow(r, t, method);
        const row: FlowRow = {
          id: obj.id,
          name: r.str('Name'),
          className: obj.className,
          kind,
          zone: t.zone,
          space: t.space,
          via: t.via,
          method,
          design,
          ...normalized(t, design),
          schedule: fieldOf(obj, r, /^Schedule Name$/),
          coefficients: coefficients(r),
          fields: others(obj, r, COMMON),
        };
        result.rows.push(row);
        const z = zoneOf(t);
        if (z && design !== undefined) {
          const target = kind === 'infiltration' ? z.infiltration : z.ventilation;
          target.design += design;
          target.objects++;
        }
      }
    }
  }

  // Infiltration that depends only on the weather.
  for (const [key, note] of [
    [
      'zoneinfiltration:effectiveleakagearea',
      'Sherman–Grimsrud model: flow = schedule × (leakage area / 1000) × √(Cs·|ΔT| + Cw·V²), in m³/s with the area in cm². It depends on the temperature difference and the wind, so it has no design value.',
    ],
    [
      'zoneinfiltration:flowcoefficient',
      'AIM-2 model: stack flow c·Cs·|ΔT|ⁿ and wind flow c·Cw·(s·V)²ⁿ, combined in quadrature, times the schedule. It depends on the temperature difference and the wind, so it has no design value.',
    ],
  ] as const) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      for (const t of resolve(obj, r)) {
        result.rows.push({
          id: obj.id,
          name: r.str('Name'),
          className: obj.className,
          kind: 'infiltration',
          zone: t.zone,
          space: t.space,
          schedule: fieldOf(obj, r, /^Schedule Name$/),
          fields: others(obj, r, /^(Name|Zone.*Name|Schedule Name)$/),
          note,
        });
        const z = zoneOf(t);
        if (z) {
          z.infiltration.objects++;
          z.infiltration.weatherOnly++;
        }
      }
    }
  }

  // Natural ventilation through a wind and stack open area.
  for (const obj of model.ofClass('zoneventilation:windandstackopenarea')) {
    const r = reader(obj);
    for (const t of resolve(obj, r)) {
      const area = r.numOr(r.find(/^Opening Area$/) ?? '', 0);
      result.rows.push({
        id: obj.id,
        name: r.str('Name'),
        className: obj.className,
        kind: 'windstack',
        zone: t.zone,
        space: t.space,
        schedule: fieldOf(obj, r, /^Opening Area Fraction Schedule Name$/),
        fields: others(obj, r, /^(Name|Zone.*Name|Opening Area Fraction Schedule Name)$/),
        note: 'Wind: Cw × opening area × fraction × wind speed, with Cw = 0.55 − 0.25 × (angle between the wind and the effective angle) / 180° when autocalculated. Stack: Cd × opening area × fraction × √(2·g·ΔH·|Tzone − Tout| / Tzone), with Cd = 0.40 + 0.0045·|ΔT| when autocalculated. The two are added in quadrature.',
      });
      const z = zoneOf(t);
      if (z) z.openArea += area;
    }
  }

  // Air exchanged between zones.
  for (const [key, kind] of [
    ['zonemixing', 'mixing'],
    ['zonecrossmixing', 'crossmixing'],
  ] as const) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const method = r.strOr(r.find(/Calculation Method$/) ?? '');
      for (const t of resolve(obj, r)) {
        const design = designFlow(r, t, method);
        result.rows.push({
          id: obj.id,
          name: r.str('Name'),
          className: obj.className,
          kind,
          zone: t.zone,
          space: t.space,
          source: r.str(r.find(/^Source Zone (or Space )?Name$/) ?? '') || undefined,
          method,
          design,
          ...normalized(t, design),
          schedule: fieldOf(obj, r, /^Schedule Name$/),
          fields: others(
            obj,
            r,
            /^(Name|Zone.*Name|Schedule Name|Design Flow Rate Calculation Method|Design Flow Rate|Flow (Rate )?per .*|Air Changes per Hour|Source Zone.*Name)$/,
          ),
        });
      }
    }
  }

  for (const obj of model.ofClass('zoneairbalance:outdoorair')) {
    const r = reader(obj);
    result.airBalance.push({
      id: obj.id,
      name: r.str('Name'),
      zone: r.str('Zone Name'),
      fields: others(obj, r, /^(Name|Zone Name)$/),
    });
  }

  for (const obj of model.ofClass('zonethermalchimney')) {
    const r = reader(obj);
    const fields = r.cls?.fields ?? [];
    const firstInlet = fields.findIndex((f) =>
      /^Zone (or Space )?Name 1$|^Zone 1 Name$/.test(f.name),
    );
    const inlets: ChimneyRow['inlets'] = [];
    if (firstInlet >= 0) {
      for (let i = firstInlet; i < obj.fields.length; i += 4) {
        const zone = (obj.fields[i] ?? '').trim();
        if (!zone) break;
        const n = (k: number) => {
          const v = Number((obj.fields[i + k] ?? '').trim());
          return obj.fields[i + k]?.trim() && Number.isFinite(v) ? v : undefined;
        };
        inlets.push({ zone, distance: n(1), ratio: n(2), area: n(3) });
      }
    }
    result.chimneys.push({
      id: obj.id,
      name: r.str('Name'),
      zone: r.str('Zone Name'),
      fields: fields
        .slice(0, firstInlet >= 0 ? firstInlet : fields.length)
        .map((f) => f.name)
        .filter((n) => !/^(Name|Zone Name)$/.test(n))
        .map((n) => fieldOf(obj, r, n))
        .filter((f): f is DescribedField => Boolean(f)),
      inlets,
    });
  }

  for (const z of summaries.values()) {
    z.infiltration.ach = z.volume > 0 ? (z.infiltration.design * 3600) / z.volume : 0;
    z.ventilation.ach = z.volume > 0 ? (z.ventilation.design * 3600) / z.volume : 0;
  }
  result.zones = [...summaries.values()];
  return result;
}
