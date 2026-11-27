/**
 * AirflowNetwork summary (L3) and opening card (L4, L5): what the IDF says about
 * the network and about each surface in it, following the chain
 * surface → component → external node. With ZoneLevel control the values that
 * apply come from AirflowNetwork:MultiZone:Zone, and each value says where it
 * comes from.
 */
import type { GeometryResult, Surface3D, SurfaceKind } from '../geometry/build';
import { length, sub, type Vec3 } from '../geometry/polygon';
import { type DescribedField, describeField } from '../model/describe';
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import type { ReferenceIndex } from '../model/references';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import {
  AFN_COMPONENTS,
  type AfnComponentType,
  type AfnModel,
  type AfnSurfaceLink,
  interpolateSet,
  type OpeningFactorSet,
  openingFactorSets,
} from './afn';
import { type OpeningRule, openingRule } from './rules';

/** A field of the AirflowNetwork input with its source and default. */
export type AfnField = DescribedField;

export interface AfnNote {
  kind: 'info' | 'warn';
  text: string;
}

export interface AfnSurfaceRow {
  surface: string;
  surfaceId?: number;
  kind?: SurfaceKind;
  zone?: string;
  link: AfnSurfaceLink;
}

export interface AfnZoneRow {
  name: string;
  zoneId: number;
  /** Id of its AirflowNetwork:MultiZone:Zone, if any. */
  afnZoneId?: number;
  mode?: string;
  fields: AfnField[];
  /** AirflowNetwork surfaces in the zone, and how many are operable openings. */
  surfaces: number;
  operable: number;
}

export interface AfnNodeRow {
  id: number;
  name: string;
  height?: number;
  cp?: string;
  cpId?: number;
  /** AirflowNetwork surfaces that use the node. */
  uses: number;
}

export interface AfnOverview {
  present: boolean;
  active: boolean;
  controlId?: number;
  settings: AfnField[];
  /** Cp come from external nodes ("Input") or EnergyPlus computes them. */
  cpInput: boolean;
  terrain?: string;
  crackConditions: { id: number; name: string; fields: AfnField[] }[];
  zones: AfnZoneRow[];
  nodes: AfnNodeRow[];
  components: { type: AfnComponentType; label: string; objects: number; uses: number }[];
  surfaces: AfnSurfaceRow[];
}

export interface AfnCp {
  /** Object that holds the coefficients. */
  source: string;
  sourceId?: number;
  sourceClass?: string;
  /** Wind directions (deg) and Cp, when given as WindPressureCoefficientValues. */
  directions: number[];
  values: number[];
}

export interface AfnCard {
  surface: {
    id?: number;
    name: string;
    className?: string;
    kind?: SurfaceKind;
    zone?: string;
    area?: number;
    rectangular: boolean;
    /** Width and height of the opening (or of its equivalent rectangle). */
    width?: number;
    height?: number;
    equivalentMethod?: string;
  };
  link: AfnSurfaceLink;
  /** Fields of the AirflowNetwork:MultiZone:Surface that are not ventilation control. */
  surfaceFields: AfnField[];
  /** Ventilation control that applies, with the source of each value. */
  control: AfnField[];
  zoneObjectId?: number;
  component: {
    name: string;
    id?: number;
    className?: string;
    label: string;
    fields: AfnField[];
    sets?: OpeningFactorSet[];
    /** DetailedOpening values interpolated at the surface's opening factor. */
    atFactor?: OpeningFactorSet;
    lvoType?: string;
    /** Open area and Cd × open area at the maximum opening factor. */
    openArea?: number;
    effectiveArea?: number;
  };
  node?: {
    name: string;
    id?: number;
    fields: AfnField[];
    cp?: AfnCp;
  };
  notes: AfnNote[];
  /** When and how much the opening opens (L6), for operable openings. */
  rule?: OpeningRule;
  /** When the venting availability schedule lets the opening open (L6). */
  availability?: Availability;
}

/**
 * The venting availability schedule over the year, at every timestep. EnergyPlus
 * lets the opening open when the schedule is above zero, whatever the value (0.5
 * opens it as much as 1); checked with 26.2.
 */
export interface Availability {
  schedule?: string;
  /** Timesteps of the year the schedule is above zero, and all of them. */
  steps: number;
  total: number;
  timestepsPerHour: number;
  evaluable: boolean;
  /**
   * Opening factor at every timestep when the opening is allowed to open: the
   * maximum opening factor when available, 0 when not. In Constant mode it is
   * the opening factor EnergyPlus uses; in other modes, its upper limit.
   */
  openable?: Float32Array;
}

type ControlUse = 'setpoint' | 'minimum' | 'deltaT' | 'deltaH' | 'availability' | 'occupant';

const CONTROL_FIELDS: { label: string; pattern: RegExp; use: ControlUse; blank?: string }[] = [
  {
    label: 'Temperature setpoint schedule',
    pattern: /^Ventilation Control Zone Temperature Setpoint Schedule Name$/,
    use: 'setpoint',
  },
  {
    label: 'Minimum venting open factor',
    pattern: /^Minimum Venting Open Factor$/,
    use: 'minimum',
  },
  {
    label: 'ΔT lower limit (fully open)',
    pattern: /Temperature Difference Lower Limit/,
    use: 'deltaT',
  },
  {
    label: 'ΔT upper limit (minimum opening)',
    pattern: /Temperature Difference Upper Limit/,
    use: 'deltaT',
  },
  {
    label: 'Δh lower limit (fully open)',
    pattern: /Enthalpy Difference Lower Limit/,
    use: 'deltaH',
  },
  {
    label: 'Δh upper limit (minimum opening)',
    pattern: /Enthalpy Difference Upper Limit/,
    use: 'deltaH',
  },
  {
    label: 'Venting availability schedule',
    pattern: /^Venting Availability Schedule Name$/,
    use: 'availability',
    blank: 'always available',
  },
  {
    label: 'Occupant ventilation control',
    pattern: /^Occupant Ventilation Control Name$/,
    use: 'occupant',
  },
];

/** Which control values each ventilation control mode uses (EnergyPlus Input Output Reference). */
export function controlUses(mode: string): Set<ControlUse> {
  switch (mode.toLowerCase()) {
    case 'temperature':
    case 'adjacenttemperature':
      return new Set(['setpoint', 'minimum', 'deltaT', 'availability', 'occupant']);
    case 'enthalpy':
    case 'adjacententhalpy':
      return new Set(['setpoint', 'minimum', 'deltaH', 'availability', 'occupant']);
    case 'constant':
    case 'ashrae55adaptive':
    case 'cen15251adaptive':
      return new Set(['availability', 'occupant']);
    default:
      return new Set();
  }
}

const SETTINGS = [
  'AirflowNetwork Control',
  'Wind Pressure Coefficient Type',
  'AirflowNetwork Wind Pressure Coefficient Array Name',
  'Height Selection for Local Wind Pressure Calculation',
  'Building Type',
  'Azimuth Angle of Long Axis of Building',
  'Ratio of Building Width Along Short Axis to Width Along Long Axis',
  'Height Dependence of External Node Temperature',
  'Initialization Type',
  'Solver',
];

export class AfnInput {
  private readonly reader: (obj: IdfObject) => FieldReader;
  private readonly surfaces = new Map<string, Surface3D>();
  private readonly afnZones = new Map<string, IdfObject>();
  private readonly control?: IdfObject;

  constructor(
    private readonly model: IdfModel,
    private readonly schema: Schema | undefined,
    private readonly geometry: GeometryResult,
    private readonly references: ReferenceIndex,
    private readonly afn: AfnModel,
  ) {
    this.reader = (obj) => new FieldReader(obj, schema?.classes[obj.className.toLowerCase()]);
    for (const s of geometry.surfaces)
      if (s.kind !== 'shading') this.surfaces.set(s.name.toLowerCase(), s);
    for (const obj of model.ofClass('airflownetwork:multizone:zone'))
      this.afnZones.set(this.reader(obj).str('Zone Name').toLowerCase(), obj);
    this.control = model.ofClass('airflownetwork:simulationcontrol')[0];
  }

  /** A field with its units, IDD default and the object it names. */
  private field(obj: IdfObject, name: string | undefined, label?: string): AfnField | undefined {
    return describeField(obj, this.reader(obj), this.references, name, label);
  }

  private fields(obj: IdfObject, names: string[]): AfnField[] {
    return names.map((n) => this.field(obj, n)).filter((f): f is AfnField => Boolean(f));
  }

  get cpInput(): boolean {
    if (!this.control) return false;
    return (
      this.reader(this.control).strOr('Wind Pressure Coefficient Type').toLowerCase() === 'input'
    );
  }

  overview(): AfnOverview {
    const control = this.control;
    const result: AfnOverview = {
      present: this.afn.present,
      active: this.afn.active,
      controlId: control?.id,
      settings: control ? this.fields(control, SETTINGS) : [],
      cpInput: this.cpInput,
      crackConditions: [],
      zones: [],
      nodes: [],
      components: [],
      surfaces: [],
    };
    const building = this.model.ofClass('building')[0];
    if (building) result.terrain = this.reader(building).strOr('Terrain') || undefined;

    for (const obj of this.model.ofClass('airflownetwork:multizone:referencecrackconditions')) {
      const r = this.reader(obj);
      result.crackConditions.push({
        id: obj.id,
        name: r.str('Name'),
        fields: this.fields(obj, [
          'Reference Temperature',
          'Reference Barometric Pressure',
          'Reference Humidity Ratio',
        ]),
      });
    }

    // Surfaces listed in the network (not the partners that share a link).
    const listed = [...this.afn.surfaces.values()].filter((l) => !l.viaPartner);
    for (const link of listed) {
      const s = this.surfaces.get(link.surface.toLowerCase());
      result.surfaces.push({
        surface: link.surface,
        surfaceId: s?.id,
        kind: s?.kind,
        zone: s?.zone,
        link,
      });
    }

    for (const zone of this.geometry.zones) {
      const afnZone = this.afnZones.get(zone.name.toLowerCase());
      // Both sides of an interzone pair connect their zones.
      const mine = [...this.afn.surfaces.entries()].filter(
        ([name]) => this.surfaces.get(name)?.zone?.toLowerCase() === zone.name.toLowerCase(),
      );
      const r = afnZone ? this.reader(afnZone) : undefined;
      result.zones.push({
        name: zone.name,
        zoneId: zone.id,
        afnZoneId: afnZone?.id,
        mode: r?.strOr('Ventilation Control Mode'),
        fields: afnZone
          ? [
              this.field(
                afnZone,
                r?.find(CONTROL_FIELDS[0]?.pattern as RegExp),
                'Setpoint schedule',
              ),
              this.field(afnZone, r?.find(/^Venting Availability Schedule Name$/), 'Availability'),
            ].filter((f): f is AfnField => Boolean(f?.value))
          : [],
        surfaces: mine.length,
        operable: mine.filter(([, link]) => link.role === 'operable').length,
      });
    }

    const nodeUses = new Map<string, number>();
    for (const l of listed) {
      if (l.externalNode)
        nodeUses.set(
          l.externalNode.toLowerCase(),
          (nodeUses.get(l.externalNode.toLowerCase()) ?? 0) + 1,
        );
    }
    for (const obj of this.model.ofClass('airflownetwork:multizone:externalnode')) {
      const r = this.reader(obj);
      const cpField = r.find(/^Wind Pressure Coefficient (Curve|Values Object) Name$/);
      const cp = this.field(obj, cpField);
      result.nodes.push({
        id: obj.id,
        name: r.str('Name'),
        height: r.numOr('External Node Height', 0),
        cp: cp?.value || undefined,
        cpId: cp?.refId,
        uses: nodeUses.get(r.str('Name').toLowerCase()) ?? 0,
      });
    }

    for (const [type, spec] of Object.entries(AFN_COMPONENTS)) {
      const objects = this.model.ofClass(spec.classKey).length;
      const uses = listed.filter((l) => l.type === type).length;
      if (objects || uses)
        result.components.push({
          type: type as AfnComponentType,
          label: spec.label,
          objects,
          uses,
        });
    }
    return result;
  }

  card(surfaceName: string): AfnCard | null {
    const link = this.afn.surfaces.get(surfaceName.toLowerCase());
    if (!link) return null;
    const afnSurface = this.model.objects[link.objectId] as IdfObject;
    const r = this.reader(afnSurface);
    const s = this.surfaces.get(surfaceName.toLowerCase());
    const notes: AfnNote[] = [];
    const info = (text: string) => notes.push({ kind: 'info', text });
    const warn = (text: string) => notes.push({ kind: 'warn', text });
    if (link.viaPartner)
      info(
        `This surface is not listed in the AirflowNetwork; its other side, ${link.viaPartner}, is, and both share the same link.`,
      );

    // Opening size: the rectangle itself, or the equivalent rectangle EnergyPlus uses.
    const rectangular = isRectangle(s?.vertices);
    let width: number | undefined;
    let height: number | undefined;
    let equivalentMethod: string | undefined;
    if (s && rectangular) {
      const [ul, ll, lr] = s.vertices as [Vec3, Vec3, Vec3];
      width = length(sub(lr, ll));
      height = length(sub(ul, ll));
    } else if (s) {
      equivalentMethod = r.has('Equivalent Rectangle Method')
        ? r.strOr('Equivalent Rectangle Method')
        : 'PolygonHeight';
      ({ width, height } = equivalentRectangle(s, equivalentMethod, this.surfaces, r));
      info(
        `The surface is not a rectangle: EnergyPlus uses an equivalent rectangle (${equivalentMethod}).`,
      );
    }

    const surfaceFields = this.fields(afnSurface, [
      'Window/Door Opening Factor, or Crack Factor',
      'Ventilation Control Mode',
      'External Node Name',
      'Equivalent Rectangle Method',
      'Equivalent Rectangle Aspect Ratio',
    ]).map((f) =>
      // The equivalent rectangle applies only to non-rectangular openings.
      f.label.startsWith('Equivalent Rectangle') && rectangular ? { ...f, unused: true } : f,
    );

    // Ventilation control: ZoneLevel takes every control value from the zone.
    const zoneLevel = link.surfaceMode.toLowerCase() === 'zonelevel';
    // With an interzone pair, the zone is that of the side listed in the network.
    const listedZone = this.surfaces.get(link.surface.toLowerCase())?.zone ?? s?.zone;
    const zoneObj =
      zoneLevel && listedZone ? this.afnZones.get(listedZone.toLowerCase()) : undefined;
    const control: AfnField[] = [];
    let rule: OpeningRule | undefined;
    if (link.role === 'operable') {
      control.push({
        label: 'Ventilation control mode',
        value: link.controlMode,
        from: zoneLevel ? 'zone' : 'surface',
        refId: zoneLevel ? zoneObj?.id : undefined,
      });
      const source = zoneLevel ? zoneObj : afnSurface;
      if (source) {
        const sr = this.reader(source);
        const uses = controlUses(link.controlMode);
        for (const spec of CONTROL_FIELDS) {
          const f = this.field(source, sr.find(spec.pattern), spec.label);
          if (f)
            control.push({
              ...f,
              from: zoneLevel ? 'zone' : 'surface',
              unused: !uses.has(spec.use),
              blank: spec.blank,
            });
        }
      }
      if (source) {
        const sr = this.reader(source);
        const num = (pattern: RegExp, fallback: number) => {
          const name = sr.find(pattern);
          return name ? sr.numOr(name, fallback) : fallback;
        };
        const text = (pattern: RegExp) => sr.str(sr.find(pattern) ?? '') || undefined;
        rule = openingRule({
          mode: link.controlMode,
          maxFactor: link.factor,
          minFactor: num(/^Minimum Venting Open Factor$/, 0),
          deltaT: [
            num(/Temperature Difference Lower Limit/, 0),
            num(/Temperature Difference Upper Limit/, 100),
          ],
          deltaH: [
            num(/Enthalpy Difference Lower Limit/, 0),
            num(/Enthalpy Difference Upper Limit/, 300000),
          ],
          setpointSchedule: text(/^Ventilation Control Zone Temperature Setpoint Schedule Name$/),
          availabilitySchedule: text(/^Venting Availability Schedule Name$/),
          occupantControl: text(/^Occupant Ventilation Control Name$/),
        });
      }
      if (zoneLevel && !zoneObj)
        warn(
          `The surface uses ZoneLevel control but zone ${listedZone ?? '?'} has no AirflowNetwork:MultiZone:Zone.`,
        );
    }

    const component = this.componentPart(link, width, height);
    if (component.lvoType?.toLowerCase() === 'horizontallypivoted')
      info(
        'Horizontally pivoted opening: EnergyPlus turns the opening factor into a pivot angle (1 = 90°), so the width and height factors are not used.',
      );

    let node: AfnCard['node'];
    if (link.externalNode) {
      const obj = this.model
        .ofClass('airflownetwork:multizone:externalnode')
        .find((o) => (o.fields[0] ?? '').trim().toLowerCase() === link.externalNode?.toLowerCase());
      node = { name: link.externalNode, id: obj?.id, fields: [] };
      if (obj) {
        const nr = this.reader(obj);
        node.fields = this.fields(obj, [
          'External Node Height',
          'Wind Pressure Coefficient Curve Name',
          'Wind Pressure Coefficient Values Object Name',
          'Symmetric Wind Pressure Coefficient Curve',
          'Wind Angle Type',
        ]);
        const cpName = nr.str(
          nr.find(/^Wind Pressure Coefficient (Curve|Values Object) Name$/) ?? '',
        );
        node.cp = cpName ? this.cp(cpName) : undefined;
      } else {
        warn(`External node ${link.externalNode} does not exist.`);
      }
    } else if (s?.boundary === 'Outdoors') {
      if (this.cpInput)
        warn('Exterior surface without external node, while Cp are Input: EnergyPlus needs one.');
      else
        info(
          'No external node: EnergyPlus computes the Cp of exterior surfaces (SurfaceAverageCalculation).',
        );
    }

    return {
      surface: {
        id: s?.id,
        name: s?.name ?? link.surface,
        className: s ? (this.model.objects[s.id] as IdfObject).className : undefined,
        kind: s?.kind,
        zone: s?.zone,
        area: s?.area,
        rectangular,
        width,
        height,
        equivalentMethod,
      },
      link,
      surfaceFields,
      control,
      zoneObjectId: zoneObj?.id,
      component,
      node,
      notes,
      rule,
    };
  }

  private componentPart(
    link: AfnSurfaceLink,
    width?: number,
    height?: number,
  ): AfnCard['component'] {
    const spec = link.type === 'missing' ? undefined : AFN_COMPONENTS[link.type];
    const obj =
      link.componentId === undefined
        ? undefined
        : (this.model.objects[link.componentId] as IdfObject);
    const part: AfnCard['component'] = {
      name: link.component,
      id: obj?.id,
      className: obj?.className,
      label: spec?.label ?? 'Not found',
      fields: [],
    };
    if (!obj) return part;
    const r = this.reader(obj);
    const cls = this.schema?.classes[obj.className.toLowerCase()];
    // Every field except the name and the opening factor sets, shown as a table.
    const names = (cls?.fields ?? [])
      .map((f) => f.name)
      .filter((n) => n !== 'Name' && !/Opening Factor \d|Factor for Opening Factor \d/.test(n));
    part.fields = this.fields(obj, names);
    const area = width !== undefined && height !== undefined ? width * height : undefined;
    if (link.type === 'detailedopening') {
      part.sets = openingFactorSets(r);
      part.lvoType = r.strOr(r.find(/^Type of Rectangul/) ?? '');
      part.atFactor = interpolateSet(part.sets, link.factor);
      if (
        area !== undefined &&
        part.atFactor &&
        part.lvoType.toLowerCase() !== 'horizontallypivoted'
      ) {
        part.openArea = area * part.atFactor.widthFactor * part.atFactor.heightFactor;
        part.effectiveArea = part.openArea * part.atFactor.cd;
      }
    } else if (link.type === 'simpleopening' || link.type === 'horizontalopening') {
      if (area !== undefined) {
        part.openArea = area * link.factor;
        part.effectiveArea = part.openArea * (link.cd ?? 1);
      }
    }
    return part;
  }

  /** Wind pressure coefficients named by an external node. */
  private cp(name: string): AfnCp {
    const lower = name.toLowerCase();
    const values = this.model
      .ofClass('airflownetwork:multizone:windpressurecoefficientvalues')
      .find((o) => (o.fields[0] ?? '').trim().toLowerCase() === lower);
    if (values) {
      const vr = this.reader(values);
      const arrayName = vr.str('AirflowNetwork:MultiZone:WindPressureCoefficientArray Name');
      const array = this.model
        .ofClass('airflownetwork:multizone:windpressurecoefficientarray')
        .find((o) => (o.fields[0] ?? '').trim().toLowerCase() === arrayName.toLowerCase());
      const numbers = (list: string[]) =>
        list
          .map((v) => Number(v.trim()))
          .filter((v, i) => list[i]?.trim() !== '' && Number.isFinite(v));
      return {
        source: vr.str('Name'),
        sourceId: values.id,
        sourceClass: values.className,
        directions: array ? numbers(array.fields.slice(1)) : [],
        values: numbers(values.fields.slice(2)),
      };
    }
    // A curve or table (9.0+): shown by name; the polar chart comes with L9.
    for (const obj of this.model.objects) {
      const cls = obj.className.toLowerCase();
      if (!(cls.startsWith('curve:') || cls.startsWith('table:'))) continue;
      if ((obj.fields[0] ?? '').trim().toLowerCase() === lower)
        return {
          source: name,
          sourceId: obj.id,
          sourceClass: obj.className,
          directions: [],
          values: [],
        };
    }
    return { source: name, directions: [], values: [] };
  }
}

function isRectangle(vs: Vec3[] | undefined): boolean {
  if (vs?.length !== 4) return false;
  const [a, b, c, d] = vs as [Vec3, Vec3, Vec3, Vec3];
  const close = (x: number, y: number) => Math.abs(x - y) <= 0.01 * Math.max(1, Math.abs(y));
  return close(length(sub(a, b)), length(sub(d, c))) && close(length(sub(a, c)), length(sub(b, d)));
}

/** EnergyPlus' equivalent rectangle of a non-rectangular opening. */
function equivalentRectangle(
  s: Surface3D,
  method: string,
  surfaces: Map<string, Surface3D>,
  r: FieldReader,
): { width?: number; height?: number } {
  const area = s.area;
  if (area <= 0) return {};
  const m = method.toLowerCase();
  let ratio: number | undefined;
  if (m === 'useraspectratio' || m === 'userdefinedaspectratio') {
    ratio = r.numOr('Equivalent Rectangle Aspect Ratio', 1);
  } else if (m === 'basesurfaceaspectratio' && s.base) {
    const base = surfaces.get(s.base.toLowerCase());
    if (base) {
      const zs = base.vertices.map((v) => v[2]);
      const h = Math.max(...zs) - Math.min(...zs);
      if (h > 0) ratio = base.area / h / h;
    }
  }
  if (ratio !== undefined && ratio > 0) {
    const height = Math.sqrt(area / ratio);
    return { width: area / height, height };
  }
  // PolygonHeight: the height of the polygon, and the width that keeps the area.
  const zs = s.vertices.map((v) => v[2]);
  const height = Math.max(...zs) - Math.min(...zs);
  return height > 0 ? { width: area / height, height } : {};
}
