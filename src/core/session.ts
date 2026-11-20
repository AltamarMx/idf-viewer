/**
 * Opening a file: decode → parse → resolve version → load schema → index.
 * Runs inside the Web Worker (A4) and in tests. The views ask the session for
 * what they show, so the main thread never holds the whole model.
 */
import {
  buildGeometry,
  type GeometryResult,
  type ShadingType,
  type SurfaceKind,
  type ZoneGeometry,
} from './geometry/build';
import { triangulate } from './geometry/polygon';
import { type ClassSummary, IdfModel, objectName, summarizeClasses } from './model/model';
import { buildReferences, type ReferenceIndex } from './model/references';
import { decodeIdf, type IdfObject, type ParseWarning, parseIdf } from './parser/idf';
import { fieldName, fieldSchema } from './schema/fields';
import type { SchemaLoader } from './schema/load';
import type { ClassDocs, Schema } from './schema/types';
import { type Resolution, resolveVersion } from './schema/version';
import { type SearchHit, search } from './search';
import { type BuildingSummary, buildingSummary } from './summary';
import { collectProblems, type Problem } from './validation/problems';

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
  /** x, y, z of each vertex, relative to GeometryView.center. */
  positions: Float32Array;
  triangles: Uint32Array;
}

export interface GeometryView {
  center: [number, number, number];
  size: [number, number, number];
  northAxis: number;
  surfaces: SurfaceView[];
  zones: ZoneGeometry[];
}

const MAX_TABLE_COLUMNS = 300;

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
    return {
      center,
      size,
      northAxis: rules.northAxis,
      zones,
      surfaces: surfaces.map((s) => {
        const positions = new Float32Array(s.vertices.length * 3);
        s.vertices.forEach((v, i) => {
          positions[i * 3] = v[0] - center[0];
          positions[i * 3 + 1] = v[1] - center[1];
          positions[i * 3 + 2] = v[2] - center[2];
        });
        const { vertices: _v, normal, ...rest } = s;
        return {
          ...rest,
          normal: normal as [number, number, number],
          positions,
          triangles: Uint32Array.from(triangulate(s.vertices, s.normal)),
        };
      }),
    };
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
  const problemCounts = { error: 0, warning: 0, info: 0 };
  for (const p of problems) problemCounts[p.severity]++;

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
    problemCounts,
    surfaceCount: geometry.surfaces.length,
  };
  return new Session(model, schema, summary, references, geometry, problems, loader);
}
