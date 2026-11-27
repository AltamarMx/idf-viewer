/**
 * epJSON reader (A5): turns an .epJSON file into the same objects as an IDF, so
 * that everything else works the same.
 *
 * In epJSON each class holds its objects by name, and each object holds its
 * fields by a name made from the IDD field name (lower case, every run of other
 * characters turned into "_"; "Vertex 1 X-coordinate" → "vertex_x_coordinate").
 * Extensible fields (vertices, schedule data…) go in one array of groups. The
 * object's key is its Name field when the class has one. Field order comes from
 * the schema of the file's version; values are kept as written (numbers with
 * their own digits).
 */
import type { ClassSchema, Schema } from '../schema/types';
import type { IdfObject, ParseWarning, ProgressCallback } from './idf';

/** A JSON value with the 1-based line where it starts (and ends, for objects and arrays). */
export type JsonNode =
  | { kind: 'object'; line: number; endLine: number; entries: JsonEntry[] }
  | { kind: 'array'; line: number; endLine: number; items: JsonNode[] }
  | { kind: 'string'; line: number; value: string }
  | { kind: 'number'; line: number; raw: string }
  | { kind: 'literal'; line: number; value: boolean | null };

export interface JsonEntry {
  key: string;
  line: number;
  value: JsonNode;
}

export class JsonSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`${message} (line ${line})`);
  }
}

const PROGRESS_EVERY = 1 << 18;

/** JSON parser that keeps lines and the text of each number. */
export function parseJson(text: string, onProgress?: ProgressCallback): JsonNode {
  let i = 0;
  let line = 1;
  let nextProgress = PROGRESS_EVERY;
  const n = text.length;
  const fail = (message: string): never => {
    throw new JsonSyntaxError(message, line);
  };
  const space = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 10) line++;
      else if (c !== 32 && c !== 9 && c !== 13) break;
      i++;
    }
    if (onProgress && i >= nextProgress) {
      onProgress(i / n);
      nextProgress = i + PROGRESS_EVERY;
    }
  };
  const string = (): string => {
    // Opening quote already checked.
    i++;
    let out = '';
    let start = i;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        out += text.slice(start, i);
        i++;
        return out;
      }
      if (c === 10) fail('Line break inside a string');
      if (c === 92) {
        out += text.slice(start, i);
        const e = text[i + 1];
        if (e === 'u') {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape');
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
        } else {
          const map: Record<string, string> = {
            '"': '"',
            '\\': '\\',
            '/': '/',
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
          };
          const v = e === undefined ? undefined : map[e];
          if (v === undefined) fail('Invalid escape in a string');
          out += v;
          i += 2;
        }
        start = i;
        continue;
      }
      i++;
    }
    return fail('Unterminated string');
  };
  const value = (): JsonNode => {
    space();
    const at = line;
    const c = text[i];
    if (c === '{') {
      i++;
      const entries: JsonEntry[] = [];
      space();
      if (text[i] === '}') {
        i++;
        return { kind: 'object', line: at, endLine: line, entries };
      }
      for (;;) {
        space();
        if (text[i] !== '"') fail('Expected a quoted key');
        const keyLine = line;
        const key = string();
        space();
        if (text[i] !== ':') fail(`Expected ":" after "${key}"`);
        i++;
        entries.push({ key, line: keyLine, value: value() });
        space();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return { kind: 'object', line: at, endLine: line, entries };
        }
        fail('Expected "," or "}"');
      }
    }
    if (c === '[') {
      i++;
      const items: JsonNode[] = [];
      space();
      if (text[i] === ']') {
        i++;
        return { kind: 'array', line: at, endLine: line, items };
      }
      for (;;) {
        items.push(value());
        space();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return { kind: 'array', line: at, endLine: line, items };
        }
        fail('Expected "," or "]"');
      }
    }
    if (c === '"') return { kind: 'string', line: at, value: string() };
    const literal = /^(true|false|null)/.exec(text.slice(i, i + 5));
    if (literal) {
      i += (literal[1] as string).length;
      const v = literal[1] === 'null' ? null : literal[1] === 'true';
      return { kind: 'literal', line: at, value: v };
    }
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (number) {
      i += number[0].length;
      return { kind: 'number', line: at, raw: number[0] };
    }
    return fail(i >= n ? 'Unexpected end of file' : `Unexpected "${c}"`);
  };
  // A byte order mark is not part of the JSON.
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  const root = value();
  space();
  if (i < n) fail('Unexpected text after the end of the JSON');
  onProgress?.(1);
  return root;
}

/** epJSON name of an IDD field ("Vertex {n} X-coordinate" → "vertex_x_coordinate"). */
export function epJsonName(fieldName: string): string {
  return fieldName
    .replace(/\s*\{n\}\s*/, ' ')
    .trim()
    .replace(/[^0-9a-zA-Z]+/g, '_')
    .toLowerCase();
}

/**
 * Classes whose object key is the first field although it is not called
 * "Name" (EnergyPlus 26.2 schema).
 */
const KEY_IS_FIRST_FIELD = new Set([
  'zonehvac:terminalunit:variablerefrigerantflow',
  'airconditioner:variablerefrigerantflow',
]);

/**
 * Classes whose IDD writes out the first extensible groups field by field: in
 * epJSON those are plain fields (with these names) and the array holds the
 * groups after them (EnergyPlus 26.2 schema).
 */
const SPELLED_OUT_GROUPS: Record<string, string[]> = {
  'materialproperty:glazingspectraldata': [1, 2, 3, 4].flatMap((g) =>
    ['wavelength', 'transmittance', 'front_reflectance', 'back_reflectance'].map(
      (f) => `${f}_${g}`,
    ),
  ),
  'site:spectrumdata': ['wavelength', 'spectrum', 'wavelength_1', 'spectrum_2'],
};

function keyIsName(classKey: string, cls: ClassSchema): boolean {
  return cls.fields[0]?.name === 'Name' || KEY_IS_FIRST_FIELD.has(classKey);
}

/** Version written in the epJSON ("Version" → any object → "version_identifier"). */
export function epJsonVersion(root: JsonNode): string | undefined {
  if (root.kind !== 'object') return undefined;
  const version = root.entries.find((e) => e.key.toLowerCase() === 'version')?.value;
  if (version?.kind !== 'object') return undefined;
  const first = version.entries[0]?.value;
  if (first?.kind !== 'object') return undefined;
  const id = first.entries.find((e) => e.key === 'version_identifier')?.value;
  return id ? scalar(id) || undefined : undefined;
}

function scalar(node: JsonNode): string | null {
  switch (node.kind) {
    case 'string':
      return node.value.trim();
    case 'number':
      return node.raw;
    case 'literal':
      return node.value === null ? '' : node.value ? 'Yes' : 'No';
    default:
      return null;
  }
}

interface ClassMap {
  cls: ClassSchema;
  nameKey: boolean;
  /** epJSON name → field index, for the fields before the extensible groups. */
  fields: Map<string, number>;
  /** epJSON name → position in an extensible group. */
  group: Map<string, number>;
  /** Groups written as plain fields before the array. */
  groupsBefore: number;
}

function classMap(classKey: string, cls: ClassSchema): ClassMap {
  const fields = new Map<string, number>();
  const group = new Map<string, number>();
  const start = cls.extensible?.start ?? cls.fields.length;
  cls.fields.forEach((f, i) => {
    if (i < start) fields.set(epJsonName(f.name), i);
    else if (cls.extensible && i < start + cls.extensible.size)
      group.set(epJsonName(f.tpl ?? f.name), i - start);
  });
  const spelled = cls.extensible ? (SPELLED_OUT_GROUPS[classKey] ?? []) : [];
  spelled.forEach((key, i) => {
    fields.set(key, start + i);
  });
  const groupsBefore = cls.extensible ? spelled.length / cls.extensible.size : 0;
  return { cls, nameKey: keyIsName(classKey, cls), fields, group, groupsBefore };
}

export interface EpJsonResult {
  objects: IdfObject[];
  warnings: ParseWarning[];
}

/**
 * Objects of an epJSON file, in the order they are written, with their fields in
 * IDD order. Without a schema (or for a class it does not know) the fields keep
 * the order of the file: the name first, then the values, then the groups.
 */
export function epJsonObjects(root: JsonNode, schema: Schema | undefined): EpJsonResult {
  const objects: IdfObject[] = [];
  const warnings: ParseWarning[] = [];
  if (root.kind !== 'object') {
    warnings.push({ line: root.line, message: 'An epJSON file must be a JSON object of classes.' });
    return { objects, warnings };
  }
  const maps = new Map<string, ClassMap | null>();
  for (const classEntry of root.entries) {
    const classKey = classEntry.key.toLowerCase();
    if (classEntry.value.kind !== 'object') {
      warnings.push({
        line: classEntry.line,
        message: `"${classEntry.key}" should hold its objects by name.`,
      });
      continue;
    }
    let map = maps.get(classKey);
    if (map === undefined) {
      const cls = schema?.classes[classKey];
      map = cls ? classMap(classKey, cls) : null;
      maps.set(classKey, map);
    }
    for (const objectEntry of classEntry.value.entries) {
      const body = objectEntry.value;
      if (body.kind !== 'object') {
        warnings.push({
          line: objectEntry.line,
          message: `${classEntry.key} "${objectEntry.key}" should be a JSON object of fields.`,
        });
        continue;
      }
      const obj: IdfObject = {
        id: objects.length,
        className: map?.cls.name ?? classEntry.key,
        fields: [],
        line: objectEntry.line,
        fieldLines: [],
        endLine: body.endLine,
      };
      const set = (index: number, value: string, line: number) => {
        while (obj.fields.length < index) {
          obj.fields.push('');
          obj.fieldLines.push(obj.line);
        }
        obj.fields[index] = value;
        obj.fieldLines[index] = line;
      };
      if (map) fillFromSchema(map, objectEntry, body, set, warnings);
      else fillInOrder(obj, objectEntry, body);
      while (obj.fields.length > 0 && obj.fields[obj.fields.length - 1] === '') {
        obj.fields.pop();
        obj.fieldLines.pop();
      }
      objects.push(obj);
    }
  }
  return { objects, warnings };
}

function fillFromSchema(
  map: ClassMap,
  objectEntry: JsonEntry,
  body: Extract<JsonNode, { kind: 'object' }>,
  set: (index: number, value: string, line: number) => void,
  warnings: ParseWarning[],
) {
  const { cls } = map;
  if (map.nameKey) set(0, objectEntry.key.trim(), objectEntry.line);
  for (const entry of body.entries) {
    const v = entry.value;
    if (v.kind === 'array' && cls.extensible) {
      const { start, size } = cls.extensible;
      v.items.forEach((item, k) => {
        if (item.kind !== 'object') {
          warnings.push({
            line: item.line,
            message: `${cls.name} "${objectEntry.key}": each item of "${entry.key}" should be an object.`,
          });
          return;
        }
        for (const g of item.entries) {
          const position = map.group.get(g.key);
          const value = scalar(g.value);
          if (position === undefined || value === null) {
            warnings.push({
              line: g.line,
              message: `${cls.name} "${objectEntry.key}": "${g.key}" is not a field of ${cls.name}.`,
            });
            continue;
          }
          set(start + (map.groupsBefore + k) * size + position, value, g.line);
        }
      });
      continue;
    }
    const index = map.fields.get(entry.key);
    const value = scalar(v);
    if (index === undefined || value === null || (index === 0 && map.nameKey)) {
      warnings.push({
        line: entry.line,
        message: `${cls.name} "${objectEntry.key}": "${entry.key}" is not a field of ${cls.name}${index === 0 ? ' (the name is the key of the object)' : ''}.`,
      });
      continue;
    }
    set(index, value, entry.line);
  }
}

function fillInOrder(
  obj: IdfObject,
  objectEntry: JsonEntry,
  body: Extract<JsonNode, { kind: 'object' }>,
) {
  obj.fields.push(objectEntry.key.trim());
  obj.fieldLines.push(objectEntry.line);
  const arrays: JsonEntry[] = [];
  for (const entry of body.entries) {
    if (entry.value.kind === 'array') {
      arrays.push(entry);
      continue;
    }
    obj.fields.push(scalar(entry.value) ?? '');
    obj.fieldLines.push(entry.line);
  }
  for (const entry of arrays) {
    if (entry.value.kind !== 'array') continue;
    for (const item of entry.value.items) {
      if (item.kind !== 'object') continue;
      for (const g of item.entries) {
        obj.fields.push(scalar(g.value) ?? '');
        obj.fieldLines.push(g.line);
      }
    }
  }
}
