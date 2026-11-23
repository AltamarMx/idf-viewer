/**
 * Flow network between zones (L11): which zones can exchange air with each
 * other and with the outdoors, and through what. It joins the AirflowNetwork
 * surfaces (openings, cracks, effective leakage areas, exhaust fans and
 * specified flows) with ZoneMixing and ZoneCrossMixing, so it also works for
 * files without AirflowNetwork.
 *
 * The other side of an AirflowNetwork surface follows its boundary condition:
 *   Outdoors  → its external node (Cp Input), or the facade it faces when
 *               EnergyPlus computes the Cp (SurfaceAverageCalculation)
 *   Surface   → the zone of the paired surface (for a window or door without
 *               its own pair, the pair of its base surface)
 *   Zone      → that zone
 * One AirflowNetwork:MultiZone:Surface covers both sides of an interzone pair,
 * so links listed for the other side (`viaPartner`) are skipped.
 */
import type { GeometryResult, Surface3D } from '../geometry/build';
import { toDeg, type Vec3, wrapDegrees } from '../geometry/polygon';
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import { type Facing, facingOf } from '../openings/windows';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import { AFN_COMPONENTS, type AfnComponentType, type AfnModel } from './afn';
import type { FlowRow } from './zoneflows';

export type NetworkLinkType = AfnComponentType | 'mixing' | 'crossmixing';

export interface NetworkNode {
  /** Unique key: "zone:<name>" or "out:<name>". */
  key: string;
  kind: 'zone' | 'outdoor';
  name: string;
  /** Zone, or AirflowNetwork:MultiZone:ExternalNode, object id. */
  id?: number;
  /** Zones: center of the floor plan and floor level (m). */
  x?: number;
  y?: number;
  level?: number;
  /** Zones: has an AirflowNetwork:MultiZone:Zone. */
  inAfn?: boolean;
  afnZoneId?: number;
  /** Outdoor nodes: where the surfaces that use it face. */
  facing?: Facing;
  /** Outdoor nodes: area-weighted azimuth of their surfaces (deg), for placement. */
  azimuth?: number;
}

export interface NetworkSurface {
  name: string;
  /** Id of the surface object, and of its AirflowNetwork:MultiZone:Surface. */
  id?: number;
  afnId: number;
  component: string;
  componentId?: number;
  factor: number;
  cd?: number;
  /** The surface is in `to` (the link is listed from the other zone). */
  reversed: boolean;
}

export interface NetworkFlowObject {
  id: number;
  name: string;
  className: string;
  /** Design flow (m³/s) before schedule, when it can be computed. */
  design?: number;
}

export interface NetworkLink {
  key: string;
  from: string;
  to: string;
  type: NetworkLinkType;
  label: string;
  /** forward: from → to (exhaust fan, ZoneMixing); both: ZoneCrossMixing. */
  direction: 'none' | 'forward' | 'both';
  surfaces: NetworkSurface[];
  objects: NetworkFlowObject[];
}

export interface NetworkWarning {
  objectId?: number;
  message: string;
}

export interface FlowNetwork {
  afn: { present: boolean; active: boolean; control?: string; cpInput: boolean };
  nodes: NetworkNode[];
  links: NetworkLink[];
  warnings: NetworkWarning[];
  /** Zones that are not drawn: no AirflowNetwork zone and no mixing. */
  zonesOutside: string[];
}

export const LINK_LABELS: Record<NetworkLinkType, string> = {
  ...(Object.fromEntries(Object.entries(AFN_COMPONENTS).map(([k, v]) => [k, v.label])) as Record<
    Exclude<AfnComponentType, 'missing'>,
    string
  >),
  missing: 'AFN component not found',
  mixing: 'Zone mixing',
  crossmixing: 'Zone cross mixing',
};

const zoneKey = (name: string) => `zone:${name.toLowerCase()}`;
const outKey = (name: string) => `out:${name.toLowerCase()}`;

/** Area-weighted center of a zone's floors, or of all its vertices. */
function zonePlacement(list: Surface3D[]): { x: number; y: number; level: number } | undefined {
  if (list.length === 0) return undefined;
  const floors = list.filter((s) => s.kind === 'floor');
  const source = floors.length > 0 ? floors : list;
  let area = 0;
  let x = 0;
  let y = 0;
  for (const s of source) {
    const n = s.vertices.length;
    const cx = s.vertices.reduce((sum, v) => sum + v[0], 0) / n;
    const cy = s.vertices.reduce((sum, v) => sum + v[1], 0) / n;
    const w = s.area > 0 ? s.area : 1;
    x += cx * w;
    y += cy * w;
    area += w;
  }
  const zs = (floors.length > 0 ? floors : list).flatMap((s) => s.vertices.map((v) => v[2]));
  return { x: x / area, y: y / area, level: Math.round(Math.min(...zs) * 10) / 10 };
}

export function flowNetwork(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
  afn: AfnModel,
  mixing: FlowRow[],
): FlowNetwork {
  const result: FlowNetwork = {
    afn: { present: afn.present, active: afn.active, control: afn.control, cpInput: true },
    nodes: [],
    links: [],
    warnings: [],
    zonesOutside: [],
  };
  if (!schema) return result;
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);

  const control = model.ofClass('airflownetwork:simulationcontrol')[0];
  if (control) {
    const type = reader(control).strOr('Wind Pressure Coefficient Type');
    result.afn.cpInput = type.toLowerCase() !== 'surfaceaveragecalculation';
  }

  // Zones, their surfaces and their place on the plan.
  const zones = new Map<string, { name: string; id: number }>();
  for (const obj of model.ofClass('zone')) {
    const name = reader(obj).str('Name');
    zones.set(name.toLowerCase(), { name, id: obj.id });
  }
  const spaceZone = new Map<string, string>();
  for (const obj of model.ofClass('space')) {
    const r = reader(obj);
    spaceZone.set(r.str('Name').toLowerCase(), r.str('Zone Name').toLowerCase());
  }
  const byZone = new Map<string, Surface3D[]>();
  const byName = new Map<string, Surface3D>();
  for (const s of geometry.surfaces) {
    if (s.kind === 'shading') continue;
    byName.set(s.name.toLowerCase(), s);
    if (!s.zone || !['wall', 'floor', 'roof', 'ceiling'].includes(s.kind)) continue;
    const list = byZone.get(s.zone.toLowerCase()) ?? [];
    list.push(s);
    byZone.set(s.zone.toLowerCase(), list);
  }
  const afnZones = new Map<string, number>();
  for (const obj of model.ofClass('airflownetwork:multizone:zone')) {
    afnZones.set(reader(obj).str('Zone Name').toLowerCase(), obj.id);
  }
  const externalNodes = new Map<string, { name: string; id: number }>();
  for (const obj of model.ofClass('airflownetwork:multizone:externalnode')) {
    const name = reader(obj).str('Name');
    externalNodes.set(name.toLowerCase(), { name, id: obj.id });
  }

  const nodes = new Map<string, NetworkNode>();
  const zoneNode = (lower: string): NetworkNode | undefined => {
    const zone = zones.get(lower);
    if (!zone) return undefined;
    const key = zoneKey(zone.name);
    let node = nodes.get(key);
    if (!node) {
      node = {
        key,
        kind: 'zone',
        name: zone.name,
        id: zone.id,
        ...zonePlacement(byZone.get(lower) ?? []),
        inAfn: afnZones.has(lower),
        afnZoneId: afnZones.get(lower),
      };
      nodes.set(key, node);
    }
    return node;
  };
  // Outdoor nodes collect the normals of their surfaces to know where they face.
  const outdoorNormals = new Map<string, { area: number; sum: Vec3 }>();
  const outdoorNode = (name: string, id: number | undefined, s: Surface3D): NetworkNode => {
    const key = outKey(name);
    let node = nodes.get(key);
    if (!node) {
      node = { key, kind: 'outdoor', name, id };
      nodes.set(key, node);
    }
    const acc = outdoorNormals.get(key) ?? { area: 0, sum: [0, 0, 0] };
    const w = s.area > 0 ? s.area : 1;
    acc.sum = [
      acc.sum[0] + s.normal[0] * w,
      acc.sum[1] + s.normal[1] * w,
      acc.sum[2] + s.normal[2] * w,
    ];
    acc.area += w;
    outdoorNormals.set(key, acc);
    return node;
  };

  const links = new Map<string, NetworkLink>();
  const addLink = (
    from: NetworkNode,
    to: NetworkNode,
    type: NetworkLinkType,
    direction: NetworkLink['direction'],
    item: { surface?: Omit<NetworkSurface, 'reversed'>; object?: NetworkFlowObject },
  ) => {
    // Undirected links are stored once per pair, in a stable order.
    const swap = direction !== 'forward' && from.key > to.key && to.kind === 'zone';
    const [a, b] = swap ? [to, from] : [from, to];
    const key = `${type}|${a.key}|${b.key}`;
    let link = links.get(key);
    if (!link) {
      link = {
        key,
        from: a.key,
        to: b.key,
        type,
        label: LINK_LABELS[type],
        direction,
        surfaces: [],
        objects: [],
      };
      links.set(key, link);
    }
    if (item.surface) link.surfaces.push({ ...item.surface, reversed: swap });
    if (item.object && !link.objects.some((o) => o.id === item.object?.id)) {
      link.objects.push(item.object);
    }
  };

  // 1. AirflowNetwork surfaces.
  const usedNodes = new Set<string>();
  const zonesWithSurfaces = new Set<string>();
  for (const link of afn.surfaces.values()) {
    if (link.viaPartner) continue;
    const s = byName.get(link.surface.toLowerCase());
    if (!s) continue; // reported by the ventilation checks
    const zoneLower = s.zone?.toLowerCase() ?? '';
    const from = zoneNode(zoneLower);
    if (!from) continue;
    zonesWithSurfaces.add(zoneLower);
    const base = s.base ? byName.get(s.base.toLowerCase()) : undefined;
    const surface: Omit<NetworkSurface, 'reversed'> = {
      name: s.name,
      id: s.id,
      afnId: link.objectId,
      component: link.component,
      componentId: link.componentId,
      factor: link.factor,
      cd: link.cd,
    };
    const direction = link.type === 'exhaustfan' ? 'forward' : 'none';

    let to: NetworkNode | undefined;
    if (s.boundary === 'Outdoors') {
      if (result.afn.cpInput) {
        const node = link.externalNode
          ? externalNodes.get(link.externalNode.toLowerCase())
          : undefined;
        if (node) usedNodes.add(node.name.toLowerCase());
        to = outdoorNode(
          node?.name ?? (link.externalNode || 'Outdoors (no external node)'),
          node?.id,
          s,
        );
      } else {
        const ref = s.kind === 'wall' || s.kind === 'roof' || s.kind === 'floor' ? s : (base ?? s);
        to = outdoorNode(`Outdoors · ${facingOf(ref.azimuth, ref.tilt)}`, undefined, s);
      }
    } else if (s.boundary === 'Surface') {
      const pairName = s.boundaryObject || base?.boundaryObject;
      const pair = pairName ? byName.get(pairName.toLowerCase()) : undefined;
      to = pair?.zone ? zoneNode(pair.zone.toLowerCase()) : undefined;
      if (!to) {
        result.warnings.push({
          objectId: link.objectId,
          message: `${s.name} is an interzone surface, but the zone on its other side was not found.`,
        });
        continue;
      }
    } else if (s.boundary === 'Zone') {
      const other = s.boundaryObject || base?.boundaryObject || '';
      to = zoneNode(other.toLowerCase()) ?? zoneNode(spaceZone.get(other.toLowerCase()) ?? '');
      if (!to) {
        result.warnings.push({
          objectId: link.objectId,
          message: `${s.name} faces zone "${other}", which does not exist.`,
        });
        continue;
      }
    } else {
      result.warnings.push({
        objectId: link.objectId,
        message: `${s.name} is in the AirflowNetwork but its outside boundary is ${s.boundary || 'not set'}; EnergyPlus links only outdoor and interzone surfaces.`,
      });
      continue;
    }
    if (to === from) continue; // both sides in the same zone
    if (to.kind === 'zone') {
      zonesWithSurfaces.add(to.name.toLowerCase());
      if (!to.inAfn) {
        result.warnings.push({
          objectId: link.objectId,
          message: `${s.name} links ${from.name} with ${to.name}, which has no AirflowNetwork:MultiZone:Zone.`,
        });
      }
    }
    addLink(from, to, link.type, direction, { surface });
  }

  for (const [key, acc] of outdoorNormals) {
    const node = nodes.get(key) as NetworkNode;
    const [nx, ny, nz] = acc.sum;
    const azimuth = wrapDegrees(toDeg(Math.atan2(nx, ny)));
    const tilt = toDeg(Math.atan2(Math.hypot(nx, ny), nz));
    node.azimuth = azimuth;
    node.facing = facingOf(azimuth, tilt);
  }

  // 2. ZoneMixing and ZoneCrossMixing (with or without AirflowNetwork).
  const zoneOf = (name: string) => {
    const lower = name.toLowerCase();
    return zones.has(lower) ? lower : spaceZone.get(lower);
  };
  for (const row of mixing) {
    if (row.kind !== 'mixing' && row.kind !== 'crossmixing') continue;
    const receiving = zoneNode(row.zone.toLowerCase());
    const sourceZone = row.source ? zoneOf(row.source) : undefined;
    const source = sourceZone ? zoneNode(sourceZone) : undefined;
    if (!receiving || !source) {
      result.warnings.push({
        objectId: row.id,
        message: `${row.name}: source zone "${row.source ?? ''}" was not found.`,
      });
      continue;
    }
    if (source === receiving) continue;
    addLink(source, receiving, row.kind, row.kind === 'mixing' ? 'forward' : 'both', {
      object: { id: row.id, name: row.name, className: row.className, design: row.design },
    });
  }

  // 3. Checks.
  for (const [lower, id] of afnZones) {
    const zone = zones.get(lower);
    if (zone && !zonesWithSurfaces.has(lower)) {
      zoneNode(lower);
      result.warnings.push({
        objectId: id,
        message: `${zone.name} has an AirflowNetwork:MultiZone:Zone but no surface in the network.`,
      });
    }
  }
  if (result.afn.cpInput) {
    for (const [lower, node] of externalNodes) {
      if (usedNodes.has(lower)) continue;
      result.warnings.push({
        objectId: node.id,
        message: `External node ${node.name} is not used by any surface.`,
      });
    }
  }
  if (nodes.size > 0) {
    for (const zone of zones.values()) {
      if (!nodes.has(zoneKey(zone.name))) result.zonesOutside.push(zone.name);
    }
  }

  result.nodes = [...nodes.values()];
  result.links = [...links.values()];
  return result;
}
