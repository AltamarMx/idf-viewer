/**
 * Opening a file: decode → parse → resolve version → load schema → index.
 * Runs inside the Web Worker (A4) and in tests. The views ask the session for
 * what they show, so the main thread never holds the whole model.
 */
import {
  type AfnComponentType,
  type AfnModel,
  type AfnRole,
  type AfnSurfaceInfo,
  readAfn,
} from './airflow/afn';
import { type AfnCard, AfnInput, type AfnOverview } from './airflow/card';
import { type ZoneFlows, zoneFlows } from './airflow/zoneflows';
import {
  buildGeometry,
  type GeometryResult,
  type ShadingType,
  type SurfaceKind,
  type ZoneGeometry,
} from './geometry/build';
import { triangulate } from './geometry/polygon';
import { type LoadsResult, type LoadType, resolveLoads, zoneSeries } from './loads/loads';
import { type OccupancyReport, occupancyReport, type ZoneRow, zoneRows } from './loads/report';
import { type ClassSummary, IdfModel, objectName, summarizeClasses } from './model/model';
import { buildReferences, type ReferenceIndex } from './model/references';
import { type WindowInventory, windowInventory } from './openings/windows';
import { decodeIdf, type IdfObject, type ParseWarning, parseIdf } from './parser/idf';
import { buildCalendar, DAY_TYPES, type DayType, type YearCalendar } from './schedules/calendar';
import { type ScheduleInfo, ScheduleSet } from './schedules/evaluate';
import { ScheduleUsage, type ScheduleUse, type UseGroup } from './schedules/usage';
import { fieldName, fieldSchema } from './schema/fields';
import type { SchemaLoader } from './schema/load';
import type { ClassDocs, Schema } from './schema/types';
import { type Resolution, resolveVersion } from './schema/version';
import { type SearchHit, search } from './search';
import { type BuildingSummary, buildingSummary } from './summary';
import { collectProblems, type Problem, sortProblems } from './validation/problems';
import { ventilationProblems } from './validation/ventilation';

export interface FileSource {
  name: string;
  buffer?: ArrayBuffer;
  text?: string;
}

export type LoadStage = 'reading' | 'parsing' | 'schema' | 'indexing';

export interface LoadProgress {
  stage: LoadStage;
  /** 0..1 within the stage, when known. */
  fraction?: number;
  message: string;
}

export interface FileSummary {
  fileName: string;
  size: number;
  encoding: string;
  lineCount: number;
  objectCount: number;
  resolution: Resolution;
  schemaBuild?: string | null;
  classes: ClassSummary[];
  warnings: ParseWarning[];
  problemCounts: { error: number; warning: number; info: number };
  surfaceCount: number;
}

export interface FieldView {
  name: string;
  value: string;
  units?: string;
  line: number;
}

export interface ObjectView {
  id: number;
  className: string;
  name?: string;
  line: number;
  fields: FieldView[];
}

export interface ObjectRef {
  id: number;
  className: string;
  name?: string;
}

export interface FieldDetail {
  index: number;
  name: string;
  value: string;
  /** The field is not written in the file (trailing fields can be omitted). */
  omitted: boolean;
  units?: string;
  defaultValue?: string;
  usesDefault: boolean;
  required: boolean;
  type?: string;
  keys?: string[];
  min?: number;
  max?: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
  line?: number;
  targets: ObjectRef[];
  broken: boolean;
  /** Index of the field in the schema, used to look up its help text. */
  helpIndex: number;
}

export interface ObjectDetail extends ObjectRef {
  classKey: string;
  group?: string;
  known: boolean;
  line: number;
  fields: FieldDetail[];
  usedBy: (ObjectRef & { fieldName: string })[];
}

export interface ClassTable {
  className: string;
  columns: string[];
  rows: { id: number; line: number; values: string[] }[];
  truncatedColumns: number;
}

export interface SurfaceView {
  id: number;
  name: string;
  className: string;
  kind: SurfaceKind;
  shading?: ShadingType;
  zone?: string;
  space?: string;
  construction?: string;
  base?: string;
  boundary?: string;
  boundaryObject?: string;
  sunExposed?: boolean;
  windExposed?: boolean;
  multiplier: number;
  area: number;
  azimuth: number;
  tilt: number;
  normal: [number, number, number];
  /** How the surface takes part in the AirflowNetwork, if it does (L2). */
  afn?: AfnBrief;
  /** x, y, z of each vertex, relative to GeometryView.center. */
  positions: Float32Array;
  triangles: Uint32Array;
}

export interface AfnBrief {
  component: string;
  type: AfnComponentType;
  role: AfnRole;
  factor: number;
  cd?: number;
  controlMode: string;
  viaPartner?: string;
}

export interface GeometryView {
  center: [number, number, number];
  size: [number, number, number];
  northAxis: number;
  surfaces: SurfaceView[];
  zones: ZoneGeometry[];
  /** AirflowNetwork:SimulationControl exists and runs the multizone network. */
  afn: { present: boolean; active: boolean };
}

const MAX_TABLE_COLUMNS = 300;

export interface CalendarView {
  year?: number;
  leap: boolean;
  jan1: DayType;
  timestepsPerHour: number;
  dates: [number, number][];
  dayTypes: DayType[];
  dst: boolean[];
  assumptions: string[];
}

export interface ScheduleListItem extends ScheduleInfo {
  uses: number;
  groups: UseGroup[];
}

export interface ScheduleDetail {
  info: ScheduleInfo;
  hourly: Float32Array | null;
  min: number;
  max: number;
  uses: ScheduleUse[];
}

export interface DayProfiles {
  timestepsPerHour: number;
  /** Timestep values of each day type on the chosen date's period. */
  profiles: { dayType: DayType; values: number[] }[];
}

export interface ZoneScheduleEntry {
  group: UseGroup;
  schedule: string;
  scheduleId: number;
  evaluable: boolean;
  uses: { objectId: number; className: string; objectName?: string; fieldName: string }[];
}

export interface ZoneLoadView {
  /** null for the whole building (with zone multipliers). */
  zone: string | null;
  floorArea: number;
  people: Float32Array;
  watts: Record<LoadType, Float32Array>;
  daylighting: boolean;
  emsSchedules: string[];
}

export class Session {
  constructor(
    readonly model: IdfModel,
    readonly schema: Schema | undefined,
    readonly summary: FileSummary,
    readonly references: ReferenceIndex,
    readonly geometry: GeometryResult,
    readonly problemList: Problem[],
    private readonly loader?: SchemaLoader,
  ) {}

  private classOf(obj: IdfObject) {
    return this.schema?.classes[obj.className.toLowerCase()];
  }

  ref(id: number): ObjectRef {
    const obj = this.model.objects[id] as IdfObject;
    const cls = this.classOf(obj);
    return { id, className: cls?.name ?? obj.className, name: objectName(obj, cls) };
  }

  classObjects(
    classKey: string,
    offset: number,
    limit: number,
  ): { total: number; objects: ObjectView[] } {
    const all = this.model.ofClass(classKey);
    const cls = this.schema?.classes[classKey.toLowerCase()];
    const objects = all.slice(offset, offset + limit).map((obj) => ({
      id: obj.id,
      className: cls?.name ?? obj.className,
      name: objectName(obj, cls),
      line: obj.line,
      fields: obj.fields.map((value, i) => {
        const fs = fieldSchema(cls, i);
        return {
          name: fs?.name ?? `Field ${i + 1}`,
          value,
          units: fs?.units,
          line: obj.fieldLines[i] ?? obj.line,
        };
      }),
    }));
    return { total: all.length, objects };
  }

  /** Everything the inspector (B2) shows for one object, with its references (B5). */
  inspect(id: number): ObjectDetail | null {
    const obj = this.model.objects[id];
    if (!obj) return null;
    const cls = this.classOf(obj);
    const outgoing = this.references.uses.get(id) ?? [];
    const broken = new Set(
      this.references.broken.filter((b) => b.objectId === id).map((b) => b.field),
    );
    const listed = cls ? (cls.extensible ? cls.extensible.start : cls.fields.length) : 0;
    const count = Math.max(obj.fields.length, listed);
    const fields: FieldDetail[] = [];
    for (let i = 0; i < count; i++) {
      const fs = fieldSchema(cls, i);
      const omitted = i >= obj.fields.length;
      const value = omitted ? '' : (obj.fields[i] ?? '');
      const defaultValue = fs?.default === undefined ? undefined : String(fs.default);
      const ext = cls?.extensible;
      fields.push({
        index: i,
        name: fs?.name ?? `Field ${i + 1}`,
        value,
        omitted,
        units: fs?.units,
        defaultValue,
        usesDefault: value === '' && defaultValue !== undefined,
        required: Boolean(fs?.required),
        type: fs?.type,
        keys: fs?.keys,
        min: fs?.min,
        max: fs?.max,
        minExclusive: fs?.minExclusive,
        maxExclusive: fs?.maxExclusive,
        line: omitted ? undefined : obj.fieldLines[i],
        targets: outgoing.filter((e) => e.field === i).map((e) => this.ref(e.to)),
        broken: broken.has(i),
        helpIndex: ext && i >= ext.start ? ext.start + ((i - ext.start) % ext.size) : i,
      });
    }
    const usedBy = (this.references.usedBy.get(id) ?? []).map((e) => {
      const from = this.model.objects[e.from] as IdfObject;
      return { ...this.ref(e.from), fieldName: fieldName(this.classOf(from), e.field) };
    });
    return {
      ...this.ref(id),
      classKey: obj.className.toLowerCase(),
      group: cls?.group,
      known: Boolean(cls),
      line: obj.line,
      fields,
      usedBy,
    };
  }

  /** All objects of a class as rows (B3). */
  classTable(classKey: string): ClassTable {
    const objects = this.model.ofClass(classKey);
    const cls = this.schema?.classes[classKey.toLowerCase()];
    const width = Math.max(
      cls ? (cls.extensible ? cls.extensible.start : cls.fields.length) : 0,
      ...objects.map((o) => o.fields.length),
    );
    const shown = Math.min(width, MAX_TABLE_COLUMNS);
    return {
      className: cls?.name ?? objects[0]?.className ?? classKey,
      columns: Array.from({ length: shown }, (_, i) => fieldName(cls, i)),
      rows: objects.map((o) => ({ id: o.id, line: o.line, values: o.fields.slice(0, shown) })),
      truncatedColumns: width - shown,
    };
  }

  geometryView(): GeometryView {
    const { surfaces, zones, rules } = this.geometry;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const s of surfaces) {
      for (const v of s.vertices) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k] as number, v[k] as number);
          max[k] = Math.max(max[k] as number, v[k] as number);
        }
      }
    }
    const has = surfaces.length > 0;
    const center = [0, 1, 2].map((k) =>
      has ? ((min[k] as number) + (max[k] as number)) / 2 : 0,
    ) as [number, number, number];
    const size = [0, 1, 2].map((k) => (has ? (max[k] as number) - (min[k] as number) : 0)) as [
      number,
      number,
      number,
    ];
    const afn = this.afn;
    return {
      center,
      size,
      northAxis: rules.northAxis,
      zones,
      afn: { present: afn.present, active: afn.active },
      surfaces: surfaces.map((s) => {
        const positions = new Float32Array(s.vertices.length * 3);
        s.vertices.forEach((v, i) => {
          positions[i * 3] = v[0] - center[0];
          positions[i * 3 + 1] = v[1] - center[1];
          positions[i * 3 + 2] = v[2] - center[2];
        });
        const { vertices: _v, normal, ...rest } = s;
        const link = s.kind === 'shading' ? undefined : afn.surfaces.get(s.name.toLowerCase());
        return {
          ...rest,
          afn: link && {
            component: link.component,
            type: link.type,
            role: link.role,
            factor: link.factor,
            cd: link.cd,
            controlMode: link.controlMode,
            viaPartner: link.viaPartner,
          },
          normal: normal as [number, number, number],
          positions,
          triangles: Uint32Array.from(triangulate(s.vertices, s.normal)),
        };
      }),
    };
  }

  private _afn?: AfnModel;

  get afn(): AfnModel {
    if (!this._afn) {
      const info = new Map<string, AfnSurfaceInfo>();
      for (const s of this.geometry.surfaces) {
        if (s.kind === 'shading') continue;
        info.set(s.name.toLowerCase(), {
          zone: s.zone,
          partner: s.boundary === 'Surface' ? s.boundaryObject : undefined,
        });
      }
      this._afn = readAfn(this.model, this.schema, info);
    }
    return this._afn;
  }

  private _afnInput?: AfnInput;

  private get afnInput(): AfnInput {
    this._afnInput ??= new AfnInput(
      this.model,
      this.schema,
      this.geometry,
      this.references,
      this.afn,
    );
    return this._afnInput;
  }

  /** AirflowNetwork summary (L3). */
  afnOverview(): AfnOverview {
    return this.afnInput.overview();
  }

  /** Opening card of one AirflowNetwork surface (L4, L5). */
  afnCard(surface: string): AfnCard | null {
    const card = this.afnInput.card(surface);
    const schedule =
      card?.control.find((f) => f.label === 'Venting availability schedule')?.value || undefined;
    if (card?.rule && card.rule.kind !== 'closed') {
      // Hours the opening may open: the availability schedule above zero.
      const hourly = schedule ? this.schedules.hourly(schedule) : null;
      const total = this.calendar.dayTypes.length * 24;
      let hours = schedule ? 0 : total;
      if (hourly) for (const v of hourly) if (v > 0) hours++;
      card.availability = { schedule, hours, total, evaluable: !schedule || Boolean(hourly) };
    }
    return card;
  }

  private _zoneFlows?: ZoneFlows;

  /** Infiltration and ventilation without AirflowNetwork, per zone (L7, L8). */
  zoneFlows(): ZoneFlows {
    this._zoneFlows ??= zoneFlows(
      this.model,
      this.schema,
      this.geometry,
      this.references,
      this.loads,
      this.afn,
    );
    return this._zoneFlows;
  }

  /** Windows and doors with their host, size, construction and AFN role (L1). */
  windows(): WindowInventory {
    return windowInventory(this.model, this.schema, this.geometry, this.afn);
  }

  buildingSummary(): BuildingSummary {
    return buildingSummary(this.model, this.schema, this.geometry);
  }

  problems(): Problem[] {
    return this.problemList;
  }

  search(query: string, limit?: number): SearchHit[] {
    return search(this.model, this.schema, query, limit);
  }

  async help(classKey: string): Promise<ClassDocs | null> {
    if (!this.loader || this.summary.resolution.kind === 'none') return null;
    const docs = await this.loader.docs(this.summary.resolution.schemaVersion);
    return docs.classes[classKey.toLowerCase()] ?? null;
  }

  // ---- Schedules and loads (phase 2a), computed on first use ----

  private _calendar?: YearCalendar;
  private _schedules?: ScheduleSet;
  private _usage?: ScheduleUsage;
  private _loads?: LoadsResult;
  private _rows?: ZoneRow[];

  get calendar(): YearCalendar {
    this._calendar ??= buildCalendar(this.model, this.schema);
    return this._calendar;
  }

  get schedules(): ScheduleSet {
    this._schedules ??= new ScheduleSet(this.model, this.schema, this.calendar);
    return this._schedules;
  }

  get usage(): ScheduleUsage {
    this._usage ??= new ScheduleUsage(this.model, this.schema, this.references, this.geometry);
    return this._usage;
  }

  get loads(): LoadsResult {
    this._loads ??= resolveLoads(this.model, this.schema, this.geometry);
    return this._loads;
  }

  calendarView(): CalendarView {
    const c = this.calendar;
    return {
      year: c.year,
      leap: c.leap,
      jan1: DAY_TYPES[c.jan1] as DayType,
      timestepsPerHour: c.timestepsPerHour,
      dates: c.dates,
      dayTypes: c.dayTypes,
      dst: c.dst,
      assumptions: c.assumptions,
    };
  }

  scheduleList(): ScheduleListItem[] {
    return this.schedules.list().map((info) => {
      const uses = this.usage.usesOf(info.id);
      return { ...info, uses: uses.length, groups: [...new Set(uses.map((u) => u.group))] };
    });
  }

  scheduleDetail(name: string): ScheduleDetail | null {
    const info = this.schedules.info(name);
    if (!info) return null;
    const hourly = this.schedules.hourly(name);
    let min = 0;
    let max = 0;
    if (hourly?.length) {
      min = Infinity;
      max = -Infinity;
      for (const v of hourly) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return {
      info,
      hourly: hourly ? hourly.slice() : null,
      min,
      max,
      uses: this.usage.usesOf(info.id),
    };
  }

  dayProfiles(name: string, day: number): DayProfiles {
    const present = new Set<DayType>(this.calendar.dayTypes);
    const types = DAY_TYPES.filter(
      (t) => DAY_TYPES.indexOf(t) < 8 || present.has(t) || t.endsWith('DesignDay'),
    );
    return {
      timestepsPerHour: this.calendar.timestepsPerHour,
      profiles: types.map((dayType) => ({
        dayType,
        values: Array.from(this.schedules.dayValues(name, day, dayType) ?? []),
      })),
    };
  }

  /** Schedules that affect a zone, grouped by what they control (F8). */
  zoneSchedules(zone: string): ZoneScheduleEntry[] {
    const wanted = zone.toLowerCase();
    const entries = new Map<string, ZoneScheduleEntry>();
    for (const info of this.schedules.list()) {
      for (const use of this.usage.usesOf(info.id)) {
        if (!use.zones.some((z) => z.toLowerCase() === wanted)) continue;
        const key = `${use.group}|${info.name.toLowerCase()}`;
        const entry = entries.get(key) ?? {
          group: use.group,
          schedule: info.name,
          scheduleId: info.id,
          evaluable: info.evaluable,
          uses: [],
        };
        entry.uses.push({
          objectId: use.objectId,
          className: use.className,
          objectName: use.objectName,
          fieldName: use.fieldName,
        });
        entries.set(key, entry);
      }
    }
    return [...entries.values()];
  }

  zoneTable(): ZoneRow[] {
    this._rows ??= zoneRows(this.model, this.schema, this.geometry, this.loads);
    return this._rows;
  }

  /** Hourly occupants and power of a zone, or of the building with multipliers (F9). */
  zoneLoads(zone: string | null, discountLost: boolean): ZoneLoadView {
    const zones = zone
      ? this.loads.zones.filter((z) => z.name.toLowerCase() === zone.toLowerCase())
      : this.loads.zones;
    const hours = this.calendar.dayTypes.length * 24;
    const sum = () => new Float32Array(hours);
    const view: ZoneLoadView = {
      zone,
      floorArea: 0,
      people: sum(),
      watts: {
        people: sum(),
        lights: sum(),
        electric: sum(),
        gas: sum(),
        hotwater: sum(),
        steam: sum(),
        other: sum(),
      },
      daylighting: false,
      emsSchedules: [],
    };
    const rows = new Map(this.zoneTable().map((r) => [r.name.toLowerCase(), r]));
    const ems = new Set<string>();
    for (const z of zones) {
      const factor = zone ? 1 : z.multiplier;
      const row = rows.get(z.name.toLowerCase());
      if (row?.partOfTotalArea !== false || zone) view.floorArea += z.floorArea * factor;
      if (row?.daylighting) view.daylighting = true;
      for (const i of z.instances)
        if (this.schedules.info(i.schedule)?.emsActuators) ems.add(i.schedule);
      const series = zoneSeries(z, this.schedules, discountLost);
      for (let h = 0; h < hours; h++)
        view.people[h] = (view.people[h] as number) + (series.people[h] as number) * factor;
      for (const type of Object.keys(view.watts) as LoadType[]) {
        const target = view.watts[type];
        const source = series.watts[type];
        for (let h = 0; h < hours; h++)
          target[h] = (target[h] as number) + (source[h] as number) * factor;
      }
    }
    view.emsSchedules = [...ems];
    return view;
  }

  occupancy(): OccupancyReport {
    return occupancyReport(this.loads, this.schedules, this.zoneTable());
  }
}

export async function openFile(
  source: FileSource,
  loader: SchemaLoader,
  onProgress: (p: LoadProgress) => void = () => {},
): Promise<Session> {
  onProgress({ stage: 'reading', message: 'Reading file' });
  let text: string;
  let encoding = 'utf-8';
  let size: number;
  if (source.buffer) {
    const decoded = decodeIdf(source.buffer);
    text = decoded.text;
    encoding = decoded.encoding;
    size = source.buffer.byteLength;
  } else {
    text = source.text ?? '';
    size = text.length;
  }

  if (/^\s*\{/.test(text)) {
    throw new Error('epJSON files are not supported yet. Please open an .idf file.');
  }

  const parsed = parseIdf(text, (fraction) =>
    onProgress({ stage: 'parsing', fraction, message: 'Reading objects' }),
  );
  const model = new IdfModel(parsed.objects);

  let resolution: Resolution;
  let schema: Schema | undefined;
  try {
    const available = await loader.availableVersions();
    resolution = resolveVersion(model.version(), available);
    if (resolution.kind !== 'none') {
      onProgress({ stage: 'schema', message: `Loading schema ${resolution.schemaVersion}` });
      schema = await loader.schema(resolution.schemaVersion);
    }
  } catch (error) {
    resolution = {
      kind: 'none',
      fileVersion: model.version(),
      message: `Schemas could not be loaded (${String(error)}). Fields are shown without names.`,
    };
  }

  onProgress({ stage: 'indexing', message: 'Indexing references and geometry' });
  const classes = summarizeClasses(model, schema);
  const references = buildReferences(model, schema);
  const geometry = buildGeometry(model, schema);
  const problems = collectProblems({
    model,
    resolution,
    parseWarnings: parsed.warnings,
    classes,
    references,
    geometryWarnings: geometry.warnings,
  });

  const summary: FileSummary = {
    fileName: source.name,
    size,
    encoding,
    lineCount: parsed.lineCount,
    objectCount: parsed.objects.length,
    resolution,
    schemaBuild: schema?.build,
    classes,
    warnings: parsed.warnings,
    problemCounts: { error: 0, warning: 0, info: 0 },
    surfaceCount: geometry.surfaces.length,
  };
  const session = new Session(model, schema, summary, references, geometry, problems, loader);
  problems.push(...ventilationProblems(model, schema, geometry, session.afn));
  sortProblems(problems);
  for (const p of problems) summary.problemCounts[p.severity]++;
  return session;
}
