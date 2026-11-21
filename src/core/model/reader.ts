import type { IdfObject } from '../parser/idf';
import type { ClassSchema } from '../schema/types';

/**
 * Reads an object's fields by name with the schema of the file's version, so the
 * same code works across EnergyPlus versions that insert or remove fields.
 */
export class FieldReader {
  private readonly index = new Map<string, number>();

  constructor(
    readonly obj: IdfObject,
    readonly cls: ClassSchema | undefined,
  ) {
    cls?.fields.forEach((f, i) => {
      this.index.set(f.name.toLowerCase(), i);
    });
  }

  has(name: string): boolean {
    return this.index.has(name.toLowerCase());
  }

  /** Position of a field in this version's schema. */
  indexOf(name: string): number | undefined {
    return this.index.get(name.toLowerCase());
  }

  /**
   * Name of the first field that matches, for fields whose name changed between
   * versions (e.g. "…for Minimun Venting Open Factor" in 8.0, "Minimum" later).
   */
  find(pattern: RegExp): string | undefined {
    return this.cls?.fields.find((f) => pattern.test(f.name))?.name;
  }

  /** Units of a field, from the schema. */
  units(name: string): string | undefined {
    const i = this.index.get(name.toLowerCase());
    return i === undefined ? undefined : this.cls?.fields[i]?.units;
  }

  /** Raw value, trimmed; "" when blank or when the field does not exist in this version. */
  str(name: string): string {
    const i = this.index.get(name.toLowerCase());
    return i === undefined ? '' : (this.obj.fields[i] ?? '').trim();
  }

  /** Raw value, or the schema default when blank (e.g. "ZoneLevel"). */
  strOr(name: string): string {
    const value = this.str(name);
    if (value) return value;
    const i = this.index.get(name.toLowerCase());
    const def = i === undefined ? undefined : this.cls?.fields[i]?.default;
    return def === undefined ? '' : String(def);
  }

  /** Numeric value, or undefined when blank, "autocalculate", "autosize"… */
  num(name: string): number | undefined {
    return toNumber(this.str(name));
  }

  /** Numeric value or the schema default (when numeric) or `fallback`. */
  numOr(name: string, fallback: number): number {
    const value = this.num(name);
    if (value !== undefined) return value;
    const i = this.index.get(name.toLowerCase());
    const def = i === undefined ? undefined : this.cls?.fields[i]?.default;
    return typeof def === 'number' ? def : fallback;
  }

  /** Values from a field to the end of the object, e.g. from "Vertex 1 X-coordinate". */
  from(name: string): string[] {
    const i = this.index.get(name.toLowerCase());
    return i === undefined ? [] : this.obj.fields.slice(i);
  }

  /** Values of the extensible groups, e.g. the x,y,z triplets of vertices. */
  extensible(): string[] {
    const start = this.cls?.extensible?.start;
    return start === undefined ? [] : this.obj.fields.slice(start);
  }
}

export function toNumber(text: string): number | undefined {
  if (!text) return undefined;
  const n = Number(text.replace(/[dD]/, 'e'));
  return Number.isFinite(n) ? n : undefined;
}
