/**
 * AirflowNetwork input (L2, and the base of L3–L6): which surfaces are in the
 * network, through which component, and their opening factor and discharge
 * coefficient. Only the input is read; how much a window opens hour by hour
 * depends on the simulation and is not computed.
 */
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';

export type AfnComponentType =
  | 'detailedopening'
  | 'simpleopening'
  | 'horizontalopening'
  | 'crack'
  | 'ela'
  | 'exhaustfan'
  | 'specifiedflow'
  | 'missing';

/** What a surface does in the network. */
export type AfnRole = 'operable' | 'leakage' | 'fan' | 'flow' | 'missing';

export const AFN_COMPONENTS: Record<
  Exclude<AfnComponentType, 'missing'>,
  { classKey: string; role: AfnRole; label: string }
> = {
  detailedopening: {
    classKey: 'airflownetwork:multizone:component:detailedopening',
    role: 'operable',
    label: 'Detailed opening',
  },
  simpleopening: {
    classKey: 'airflownetwork:multizone:component:simpleopening',
    role: 'operable',
    label: 'Simple opening',
  },
  horizontalopening: {
    classKey: 'airflownetwork:multizone:component:horizontalopening',
    role: 'operable',
    label: 'Horizontal opening',
  },
  crack: { classKey: 'airflownetwork:multizone:surface:crack', role: 'leakage', label: 'Crack' },
  ela: {
    classKey: 'airflownetwork:multizone:surface:effectiveleakagearea',
    role: 'leakage',
    label: 'Effective leakage area',
  },
  exhaustfan: {
    classKey: 'airflownetwork:multizone:component:zoneexhaustfan',
    role: 'fan',
    label: 'Zone exhaust fan',
  },
  specifiedflow: {
    classKey: 'airflownetwork:multizone:specifiedflowrate',
    role: 'flow',
    label: 'Specified flow rate',
  },
};

export interface OpeningFactorSet {
  openingFactor: number;
  cd: number;
  widthFactor: number;
  heightFactor: number;
  startHeightFactor: number;
}

export interface AfnSurfaceLink {
  /** Id of the AirflowNetwork:MultiZone:Surface object. */
  objectId: number;
  surface: string;
  component: string;
  componentId?: number;
  type: AfnComponentType;
  role: AfnRole;
  /** "Window/Door Opening Factor, or Crack Factor": maximum opening of an opening. */
  factor: number;
  /** Discharge coefficient at that opening factor (openings and ELA). */
  cd?: number;
  externalNode?: string;
  /** Ventilation control mode as written on the surface ("ZoneLevel" by default). */
  surfaceMode: string;
  /** Mode that applies: the zone's mode when the surface says ZoneLevel. */
  controlMode: string;
  /** The surface says ZoneLevel but its zone has no AirflowNetwork:MultiZone:Zone. */
  zoneMissing: boolean;
  /**
   * Set when the link is listed for the other side of an interzone surface:
   * one AirflowNetwork:MultiZone:Surface covers both sides of the pair.
   */
  viaPartner?: string;
}

export interface AfnSurfaceInfo {
  zone?: string;
  /** Other side of an interzone surface ("Surface" boundary). */
  partner?: string;
}

export interface AfnModel {
  /** AirflowNetwork:SimulationControl exists. */
  present: boolean;
  /** Its control is not NoMultizoneOrDistribution, so EnergyPlus runs the network. */
  active: boolean;
  control?: string;
  /** Links by lowercase surface name. */
  surfaces: Map<string, AfnSurfaceLink>;
}

/**
 * Values of a DetailedOpening at an opening factor. EnergyPlus interpolates the
 * discharge coefficient and the width, height and start height factors linearly
 * between the opening factor sets.
 */
export function interpolateSet(
  sets: OpeningFactorSet[],
  factor: number,
): OpeningFactorSet | undefined {
  if (sets.length === 0) return undefined;
  const sorted = [...sets].sort((a, b) => a.openingFactor - b.openingFactor);
  const first = sorted[0] as OpeningFactorSet;
  const last = sorted[sorted.length - 1] as OpeningFactorSet;
  if (factor <= first.openingFactor) return { ...first, openingFactor: factor };
  if (factor >= last.openingFactor) return { ...last, openingFactor: factor };
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as OpeningFactorSet;
    const b = sorted[i] as OpeningFactorSet;
    if (factor > b.openingFactor) continue;
    const span = b.openingFactor - a.openingFactor;
    const t = span > 0 ? (factor - a.openingFactor) / span : 1;
    const mix = (x: number, y: number) => x + (y - x) * t;
    return {
      openingFactor: factor,
      cd: mix(a.cd, b.cd),
      widthFactor: mix(a.widthFactor, b.widthFactor),
      heightFactor: mix(a.heightFactor, b.heightFactor),
      startHeightFactor: mix(a.startHeightFactor, b.startHeightFactor),
    };
  }
  return { ...last, openingFactor: factor };
}

/** Discharge coefficient of a DetailedOpening at an opening factor. */
export function interpolateCd(sets: OpeningFactorSet[], factor: number): number | undefined {
  return interpolateSet(sets, factor)?.cd;
}

export function openingFactorSets(r: FieldReader): OpeningFactorSet[] {
  const count = r.num('Number of Sets of Opening Factor Data') ?? 0;
  const sets: OpeningFactorSet[] = [];
  for (let i = 1; i <= Math.min(count, 4); i++) {
    const openingFactor = r.num(`Opening Factor ${i}`);
    if (openingFactor === undefined) continue;
    sets.push({
      openingFactor,
      cd: r.numOr(`Discharge Coefficient for Opening Factor ${i}`, 1),
      widthFactor: r.numOr(`Width Factor for Opening Factor ${i}`, 0),
      heightFactor: r.numOr(`Height Factor for Opening Factor ${i}`, 0),
      startHeightFactor: r.numOr(`Start Height Factor for Opening Factor ${i}`, 0),
    });
  }
  return sets;
}

/**
 * @param surfaces zone and interzone partner of each surface (by lowercase
 *   name), to resolve ZoneLevel control and the other side of interzone pairs.
 */
export function readAfn(
  model: IdfModel,
  schema: Schema | undefined,
  surfaces: Map<string, AfnSurfaceInfo>,
): AfnModel {
  const result: AfnModel = { present: false, active: false, surfaces: new Map() };
  if (!schema) return result;
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);

  const control = model.ofClass('airflownetwork:simulationcontrol')[0];
  if (control) {
    result.present = true;
    result.control = reader(control).strOr('AirflowNetwork Control');
    result.active = result.control.toLowerCase() !== 'nomultizoneordistribution';
  }

  const components = new Map<string, { type: AfnComponentType; obj: IdfObject }>();
  for (const [type, spec] of Object.entries(AFN_COMPONENTS)) {
    for (const obj of model.ofClass(spec.classKey)) {
      components.set((obj.fields[0] ?? '').trim().toLowerCase(), {
        type: type as AfnComponentType,
        obj,
      });
    }
  }

  const zoneModes = new Map<string, string>();
  for (const obj of model.ofClass('airflownetwork:multizone:zone')) {
    const r = reader(obj);
    zoneModes.set(r.str('Zone Name').toLowerCase(), r.strOr('Ventilation Control Mode'));
  }

  for (const obj of model.ofClass('airflownetwork:multizone:surface')) {
    const r = reader(obj);
    const surface = r.str('Surface Name');
    const component = r.str('Leakage Component Name');
    const found = components.get(component.toLowerCase());
    const type: AfnComponentType = found?.type ?? 'missing';
    const role: AfnRole = found
      ? AFN_COMPONENTS[found.type as keyof typeof AFN_COMPONENTS].role
      : 'missing';
    const factor = r.numOr('Window/Door Opening Factor, or Crack Factor', 1);

    let cd: number | undefined;
    if (found) {
      const c = reader(found.obj);
      if (type === 'detailedopening') cd = interpolateCd(openingFactorSets(c), factor);
      else if (type === 'simpleopening' || type === 'horizontalopening' || type === 'ela')
        cd = c.numOr('Discharge Coefficient', 1);
    }

    const surfaceMode = r.strOr('Ventilation Control Mode');
    let controlMode = surfaceMode;
    let zoneMissing = false;
    if (surfaceMode.toLowerCase() === 'zonelevel') {
      const zone = surfaces.get(surface.toLowerCase())?.zone?.toLowerCase() ?? '';
      const mode = zoneModes.get(zone);
      if (mode === undefined) zoneMissing = true;
      else controlMode = mode;
    }

    result.surfaces.set(surface.toLowerCase(), {
      objectId: obj.id,
      surface,
      component,
      componentId: found?.obj.id,
      type,
      role,
      factor,
      cd,
      externalNode: r.str('External Node Name') || undefined,
      surfaceMode,
      controlMode,
      zoneMissing,
    });
  }

  for (const [name, info] of surfaces) {
    const partner = info.partner?.toLowerCase();
    if (!partner || partner === name || result.surfaces.has(name)) continue;
    const link = result.surfaces.get(partner);
    if (link && !link.viaPartner) result.surfaces.set(name, { ...link, viaPartner: link.surface });
  }
  return result;
}
