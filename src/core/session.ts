/**
 * Opening a file: decode → parse → resolve version → load schema → index.
 * Runs inside the Web Worker (A4) and in tests.
 */
import { type ClassSummary, IdfModel, objectName, summarizeClasses } from './model/model';
import { decodeIdf, type ParseWarning, parseIdf } from './parser/idf';
import { fieldSchema } from './schema/fields';
import type { SchemaLoader } from './schema/load';
import type { Schema } from './schema/types';
import { type Resolution, resolveVersion } from './schema/version';

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

export class Session {
  constructor(
    readonly model: IdfModel,
    readonly schema: Schema | undefined,
    readonly summary: FileSummary,
  ) {}

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

  onProgress({ stage: 'indexing', message: 'Indexing' });
  const summary: FileSummary = {
    fileName: source.name,
    size,
    encoding,
    lineCount: parsed.lineCount,
    objectCount: parsed.objects.length,
    resolution,
    schemaBuild: schema?.build,
    classes: summarizeClasses(model, schema),
    warnings: parsed.warnings,
  };
  return new Session(model, schema, summary);
}
