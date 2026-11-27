/**
 * Ventilation checks (L12) for the problems panel. Like the rest of the panel,
 * a quick pre-check of the input, not EnergyPlus' own validation.
 */
import type { AfnModel } from '../airflow/afn';
import { openingFactorSets } from '../airflow/afn';
import type { GeometryResult } from '../geometry/build';
import { length, sub, type Vec3 } from '../geometry/polygon';
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import { TARGET_FIELDS, zoneTargets } from '../model/targets';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import type { Problem } from './problems';

const ZONE_FLOW_CLASSES = [
  'zoneinfiltration:designflowrate',
  'zoneinfiltration:effectiveleakagearea',
  'zoneinfiltration:flowcoefficient',
  'zoneventilation:designflowrate',
  'zoneventilation:windandstackopenarea',
  'zonemixing',
  'zonecrossmixing',
];

const OPENINGS = new Set(['detailedopening', 'simpleopening', 'horizontalopening']);
/** Subsurfaces that can carry an opening (besides surfaces with an air boundary). */
const OPENING_HOSTS = new Set(['window', 'door', 'glassdoor']);
const LABEL: Record<string, string> = {
  detailedopening: 'DetailedOpening',
  simpleopening: 'SimpleOpening',
  horizontalopening: 'HorizontalOpening',
};

export function ventilationProblems(
  model: IdfModel,
  schema: Schema | undefined,
  geometry: GeometryResult,
  afn: AfnModel,
): Problem[] {
  const problems: Problem[] = [];
  if (!schema) return problems;
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);
  const at = (obj: IdfObject, field?: string) => {
    const i = field ? reader(obj).indexOf(field) : undefined;
    return { objectId: obj.id, line: (i !== undefined && obj.fieldLines[i]) || obj.line };
  };
  const add = (severity: Problem['severity'], message: string, obj: IdfObject, field?: string) =>
    problems.push({ severity, category: 'Ventilation', message, ...at(obj, field) });

  const surfaces = new Map(
    geometry.surfaces.filter((s) => s.kind !== 'shading').map((s) => [s.name.toLowerCase(), s]),
  );
  const listed = [...afn.surfaces.values()].filter((l) => !l.viaPartner);
  const afnSurfaceObjects = model.ofClass('airflownetwork:multizone:surface');

  // The network is in the file but EnergyPlus will not run it.
  const control = model.ofClass('airflownetwork:simulationcontrol')[0];
  if (afnSurfaceObjects.length > 0 && !afn.active) {
    const first = afnSurfaceObjects[0] as IdfObject;
    add(
      'info',
      control
        ? `AirflowNetwork Control is ${afn.control}: the ${afnSurfaceObjects.length} AirflowNetwork surfaces have no effect.`
        : `There are ${afnSurfaceObjects.length} AirflowNetwork surfaces but no AirflowNetwork:SimulationControl: they have no effect.`,
      control ?? first,
    );
  }

  // Zones of the network.
  const afnZones = new Map<string, IdfObject>();
  for (const obj of model.ofClass('airflownetwork:multizone:zone'))
    afnZones.set(reader(obj).str('Zone Name').toLowerCase(), obj);
  const networkZones = new Set<string>();
  for (const link of listed) {
    const s = surfaces.get(link.surface.toLowerCase());
    if (s?.zone) networkZones.add(s.zone.toLowerCase());
  }
  for (const zone of networkZones) {
    if (afnZones.has(zone)) continue;
    const link = listed.find(
      (l) => surfaces.get(l.surface.toLowerCase())?.zone?.toLowerCase() === zone,
    );
    const obj = link && (model.objects[link.objectId] as IdfObject);
    const name = geometry.zones.find((z) => z.name.toLowerCase() === zone)?.name ?? zone;
    if (obj)
      add(
        'error',
        `Zone ${name} has AirflowNetwork surfaces but no AirflowNetwork:MultiZone:Zone.`,
        obj,
        'Surface Name',
      );
  }

  // Zones of the network that also have zone infiltration, ventilation or mixing.
  if (afn.active) {
    const targets = zoneTargets(model, schema, geometry);
    const inNetwork = new Set([...networkZones, ...afnZones.keys()]);
    for (const key of ZONE_FLOW_CLASSES) {
      for (const obj of model.ofClass(key)) {
        const r = reader(obj);
        const field = TARGET_FIELDS.map((p) => r.find(p)).find(Boolean);
        const zones = targets(field ? r.str(field) : '')
          .map((t) => t.zone)
          .filter((z) => inNetwork.has(z.toLowerCase()));
        if (zones.length)
          add(
            'warning',
            `${obj.className} ${r.str('Name')} applies to ${[...new Set(zones)].join(', ')}, which ${zones.length === 1 ? 'is' : 'are'} in the AirflowNetwork: EnergyPlus does not use it there.`,
            obj,
          );
      }
    }
  }

  // Components.
  for (const obj of model.ofClass('airflownetwork:multizone:component:detailedopening')) {
    const r = reader(obj);
    const sets = openingFactorSets(r);
    const factors = sets.map((s) => s.openingFactor);
    if (sets.length < 2)
      add(
        'error',
        `${r.str('Name')}: a detailed opening needs at least 2 opening factor sets.`,
        obj,
      );
    else {
      if (factors[0] !== 0)
        add(
          'error',
          `${r.str('Name')}: Opening Factor 1 must be 0 (it is ${factors[0]}).`,
          obj,
          'Opening Factor 1',
        );
      if (factors[factors.length - 1] !== 1)
        add(
          'error',
          `${r.str('Name')}: the last opening factor must be 1 (it is ${factors[factors.length - 1]}).`,
          obj,
        );
      if (factors.some((f, i) => i > 0 && f <= (factors[i - 1] as number)))
        add(
          'error',
          `${r.str('Name')}: opening factors must increase (${factors.join(', ')}).`,
          obj,
        );
    }
    sets.forEach((s, i) => {
      if (s.cd <= 0 || s.cd > 1)
        add(
          'error',
          `${r.str('Name')}: discharge coefficient ${s.cd} for opening factor ${i + 1} is outside (0, 1].`,
          obj,
          `Discharge Coefficient for Opening Factor ${i + 1}`,
        );
      for (const [label, v] of [
        ['Width', s.widthFactor],
        ['Height', s.heightFactor],
        ['Start Height', s.startHeightFactor],
      ] as const) {
        if (v < 0 || v > 1)
          add(
            'error',
            `${r.str('Name')}: ${label.toLowerCase()} factor ${v} for opening factor ${i + 1} is outside [0, 1].`,
            obj,
          );
      }
      if (s.heightFactor + s.startHeightFactor > 1 + 1e-9)
        add(
          'warning',
          `${r.str('Name')}: for opening factor ${i + 1}, start height + height factor is ${formatSum(s.heightFactor + s.startHeightFactor)}: the opening goes above the window.`,
          obj,
        );
    });
  }
  for (const key of [
    'airflownetwork:multizone:component:simpleopening',
    'airflownetwork:multizone:component:horizontalopening',
    'airflownetwork:multizone:surface:effectiveleakagearea',
  ]) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      const cd = r.num('Discharge Coefficient');
      if (cd !== undefined && (cd <= 0 || cd > 1))
        add(
          'error',
          `${r.str('Name')}: discharge coefficient ${cd} is outside (0, 1].`,
          obj,
          'Discharge Coefficient',
        );
    }
  }

  // Rules EnergyPlus checks when it reads the network (confirmed with EnergyPlus 26.2).
  if (afn.active) {
    const airBoundaries = new Set(
      model.ofClass('construction:airboundary').map((o) => (o.fields[0] ?? '').toLowerCase()),
    );
    const boundaryOf = (name: string): string | undefined => {
      const s = surfaces.get(name.toLowerCase());
      if (!s) return undefined;
      if (s.boundary) return s.boundary;
      return s.base ? boundaryOf(s.base) : undefined;
    };
    for (const link of listed) {
      const s = surfaces.get(link.surface.toLowerCase());
      if (!s || !OPENINGS.has(link.type)) continue;
      const obj = model.objects[link.objectId] as IdfObject;
      const label = LABEL[link.type];
      const airBoundary = airBoundaries.has((s.construction ?? '').toLowerCase());
      if (!OPENING_HOSTS.has(s.kind) && !airBoundary) {
        add(
          'error',
          `${link.surface} is a ${s.kind}: a ${label} must be on a window, door, glass door or air boundary.`,
          obj,
          'Leakage Component Name',
        );
        continue;
      }
      const boundary = boundaryOf(link.surface)?.toLowerCase();
      if (link.type === 'horizontalopening' && boundary === 'outdoors')
        add(
          'error',
          `${link.surface} is exposed to outdoors: a HorizontalOpening must be between two zones.`,
          obj,
          'Leakage Component Name',
        );
      const horizontal = s.tilt < 10 || s.tilt > 170;
      if (horizontal && link.type === 'simpleopening')
        add(
          'error',
          `${link.surface} is within 10° of horizontal: EnergyPlus does not allow a SimpleOpening there.`,
          obj,
          'Leakage Component Name',
        );
      if (horizontal && link.type === 'detailedopening')
        add(
          'warning',
          `${link.surface} is within 10° of horizontal: EnergyPlus models a DetailedOpening there poorly, with one-way airflow only.`,
          obj,
          'Leakage Component Name',
        );
    }

    // Every zone of the network needs at least two surfaces in it (each side of
    // an interzone surface counts for its zone).
    const perZone = new Map<string, number>();
    for (const name of afn.surfaces.keys()) {
      const zone = surfaces.get(name)?.zone?.toLowerCase();
      if (zone) perZone.set(zone, (perZone.get(zone) ?? 0) + 1);
    }
    for (const [zone, obj] of afnZones) {
      const count = perZone.get(zone) ?? 0;
      if (count >= 2) continue;
      add(
        'error',
        `${reader(obj).str('Zone Name')} has ${count === 0 ? 'no surface' : 'only one surface'} in the AirflowNetwork: EnergyPlus needs at least two.`,
        obj,
        'Zone Name',
      );
    }

    // A zone exhaust fan component is the AirflowNetwork side of a Fan:ZoneExhaust.
    const fans = new Set(
      model.ofClass('fan:zoneexhaust').map((o) => (o.fields[0] ?? '').toLowerCase()),
    );
    for (const obj of model.ofClass('airflownetwork:multizone:component:zoneexhaustfan')) {
      const name = obj.fields[0] ?? '';
      if (!fans.has(name.toLowerCase()))
        add(
          'error',
          `${name}: there is no Fan:ZoneExhaust with this name; EnergyPlus needs one for the exhaust fan component.`,
          obj,
        );
    }
  }

  // Surfaces.
  const cpInput =
    control !== undefined &&
    reader(control).strOr('Wind Pressure Coefficient Type').toLowerCase() === 'input';
  for (const link of listed) {
    const obj = model.objects[link.objectId] as IdfObject;
    const r = reader(obj);
    const s = surfaces.get(link.surface.toLowerCase());
    if (s && cpInput && s.boundary === 'Outdoors' && !link.externalNode)
      add(
        'error',
        `${link.surface} is exterior and Cp are Input, but it has no External Node Name.`,
        obj,
        'External Node Name',
      );
    if (s && OPENINGS.has(link.type) && !isRectangle(s.vertices))
      add(
        'info',
        `${link.surface} is not a rectangle: EnergyPlus models the opening as an equivalent rectangle${r.has('Equivalent Rectangle Method') ? ` (${r.strOr('Equivalent Rectangle Method')})` : ''}.`,
        obj,
      );
    // Limits of Temperature and Enthalpy control written on the surface.
    if (link.role === 'operable' && link.surfaceMode.toLowerCase() !== 'zonelevel')
      checkLimits(obj, r, link.controlMode, add);
  }
  for (const obj of afnZones.values()) {
    const r = reader(obj);
    checkLimits(obj, r, r.strOr('Ventilation Control Mode'), add);
  }

  // Openings whose opening factor an EMS program sets.
  for (const obj of model.ofClass('energymanagementsystem:actuator')) {
    const r = reader(obj);
    if (!/air ?flow ?network window\/door opening/i.test(r.str('Actuated Component Type')))
      continue;
    const surface = r.str('Actuated Component Unique Name');
    add(
      'info',
      `EMS sets the opening factor of ${surface} (${r.str('Name')}): the opening rules shown for it do not apply.`,
      obj,
    );
  }

  return problems;
}

function formatSum(n: number) {
  return String(Number(n.toPrecision(3)));
}

function checkLimits(
  obj: IdfObject,
  r: FieldReader,
  mode: string,
  add: (s: Problem['severity'], m: string, o: IdfObject, f?: string) => void,
) {
  const m = mode.toLowerCase();
  const pairs: [RegExp, RegExp, string][] = [];
  if (m === 'temperature' || m === 'adjacenttemperature')
    pairs.push([/Temperature Difference Lower Limit/, /Temperature Difference Upper Limit/, 'ΔT']);
  if (m === 'enthalpy' || m === 'adjacententhalpy')
    pairs.push([/Enthalpy Difference Lower Limit/, /Enthalpy Difference Upper Limit/, 'Δh']);
  for (const [lowP, upP, label] of pairs) {
    const low = r.find(lowP);
    const up = r.find(upP);
    if (!low || !up) continue;
    const lo = r.numOr(low, 0);
    const hi = r.numOr(up, 0);
    if (hi <= lo)
      add(
        'warning',
        `${obj.fields[0] ?? ''}: the ${label} upper limit (${hi}) is not greater than the lower limit (${lo}); EnergyPlus resets it to ${label === 'ΔT' ? '100' : '300000'}.`,
        obj,
        up,
      );
  }
}

function isRectangle(vs: Vec3[]): boolean {
  if (vs.length !== 4) return false;
  const [a, b, c, d] = vs as [Vec3, Vec3, Vec3, Vec3];
  const close = (x: number, y: number) => Math.abs(x - y) <= 0.01 * Math.max(1, Math.abs(y));
  return close(length(sub(a, b)), length(sub(d, c))) && close(length(sub(a, c)), length(sub(b, d)));
}
