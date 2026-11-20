import type { ClassSchema, FieldSchema } from './types';

/**
 * Schema of the field at `index` (0-based, after the class name), including the
 * repeated groups of extensible objects, which the schema lists only once.
 */
export function fieldSchema(cls: ClassSchema | undefined, index: number): FieldSchema | undefined {
  if (!cls) return undefined;
  const direct = cls.fields[index];
  const ext = cls.extensible;
  if (!ext || index < ext.start) return direct;

  const offset = index - ext.start;
  const group = Math.floor(offset / ext.size);
  const base = cls.fields[ext.start + (offset % ext.size)];
  if (!base) return undefined;
  if (group === 0) return base;
  const number = group + (base.n0 ?? 1);
  const name = base.tpl ? base.tpl.replace('{n}', String(number)) : `${base.name} ${group + 1}`;
  return { ...base, name, required: false };
}

/** Field name for display; "Field N" when the class is unknown or the field is beyond the schema. */
export function fieldName(cls: ClassSchema | undefined, index: number): string {
  return fieldSchema(cls, index)?.name ?? `Field ${index + 1}`;
}

/** Index of a field by name (case-insensitive), or -1. Only looks at the listed fields. */
export function fieldIndex(cls: ClassSchema | undefined, name: string): number {
  if (!cls) return -1;
  const wanted = name.toLowerCase();
  return cls.fields.findIndex((f) => f.name.toLowerCase() === wanted);
}
