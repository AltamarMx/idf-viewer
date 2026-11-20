import type { IdfObject } from '../parser/idf';
import { fieldSchema } from '../schema/fields';
import type { ClassSchema, Schema } from '../schema/types';

/** Objects of one file, indexed by class. Class names are compared case-insensitively, like EnergyPlus. */
export class IdfModel {
  readonly byClass = new Map<string, number[]>();

  constructor(readonly objects: IdfObject[]) {
    for (const obj of objects) {
      const key = obj.className.toLowerCase();
      let ids = this.byClass.get(key);
      if (!ids) {
        ids = [];
        this.byClass.set(key, ids);
      }
      ids.push(obj.id);
    }
  }

  ofClass(classKey: string): IdfObject[] {
    return (this.byClass.get(classKey.toLowerCase()) ?? []).map(
      (id) => this.objects[id] as IdfObject,
    );
  }

  /** Value of the Version object ("26.2", "9.0.1"...), if any. */
  version(): string | undefined {
    return this.ofClass('version')[0]?.fields[0]?.trim() || undefined;
  }
}

export interface ClassSummary {
  /** Lowercase class name. */
  key: string;
  /** Name as in the schema, or as written in the file when the class is unknown. */
  name: string;
  group: string;
  count: number;
  /** False when the class is not in the schema (typo, other version or schemaless mode). */
  known: boolean;
}

export const UNKNOWN_GROUP = 'Not in schema';

/** Classes present in the file, in IDD order (groups, then classes), unknown classes last. */
export function summarizeClasses(model: IdfModel, schema: Schema | undefined): ClassSummary[] {
  const order = new Map(Object.keys(schema?.classes ?? {}).map((key, i) => [key, i]));
  const summaries: ClassSummary[] = [];
  for (const [key, ids] of model.byClass) {
    const cls = schema?.classes[key];
    const first = model.objects[ids[0] as number] as IdfObject;
    summaries.push({
      key,
      name: cls?.name ?? first.className,
      group: cls ? (cls.group ?? 'Other') : UNKNOWN_GROUP,
      count: ids.length,
      known: Boolean(cls),
    });
  }
  return summaries.sort((a, b) => {
    const ia = order.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const ib = order.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    return ia - ib || a.name.localeCompare(b.name);
  });
}

/** The object's name when its first field is a name ("Name", "Zone Name"...). */
export function objectName(obj: IdfObject, cls: ClassSchema | undefined): string | undefined {
  const first = fieldSchema(cls, 0);
  if (!first || !/name$/i.test(first.name)) return undefined;
  return obj.fields[0] || undefined;
}
