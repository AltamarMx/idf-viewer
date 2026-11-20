/**
 * Cross references between objects (B5) and the checks that come from them (H1).
 *
 * The IDD says which fields give a name to a list (`\reference ZoneNames`) and
 * which fields point to a list (`\object-list ZoneNames`). Some lists hold class
 * names instead of object names (`\reference-class-name`), e.g. the component
 * types of a Branch. Names are compared case-insensitively, like EnergyPlus.
 */
import type { IdfObject } from '../parser/idf';
import { fieldSchema } from '../schema/fields';
import type { Schema } from '../schema/types';
import type { IdfModel } from './model';

export interface RefEdge {
  from: number;
  /** Field index in the "from" object. */
  field: number;
  to: number;
}

export interface BrokenRef {
  objectId: number;
  field: number;
  fieldName: string;
  value: string;
  lists: string[];
}

export interface DuplicateName {
  className: string;
  name: string;
  objectIds: number[];
}

export interface ReferenceIndex {
  uses: Map<number, RefEdge[]>;
  usedBy: Map<number, RefEdge[]>;
  broken: BrokenRef[];
  duplicates: DuplicateName[];
}

/**
 * Values EnergyPlus accepts in some object-list fields without an object of that
 * name. Kept short on purpose: anything else that is not found is reported.
 */
const BUILT_IN_NAMES = new Set(['', 'none']);

export function buildReferences(model: IdfModel, schema: Schema | undefined): ReferenceIndex {
  const uses = new Map<number, RefEdge[]>();
  const usedBy = new Map<number, RefEdge[]>();
  const broken: BrokenRef[] = [];
  const duplicates: DuplicateName[] = [];
  if (!schema) return { uses, usedBy, broken, duplicates };

  // List name (lowercase) → object name (lowercase) → object ids.
  const lists = new Map<string, Map<string, number[]>>();
  const register = (list: string, name: string, id: number) => {
    const key = list.toLowerCase();
    let names = lists.get(key);
    if (!names) {
      names = new Map();
      lists.set(key, names);
    }
    const ids = names.get(name) ?? [];
    if (!ids.includes(id)) ids.push(id);
    names.set(name, ids);
  };

  // Lists of class names.
  const classLists = new Map<string, Set<string>>();
  for (const cls of Object.values(schema.classes)) {
    // Declared on the class or, usually, on its Name field.
    const names = [
      ...(cls.refClass ?? []),
      ...cls.fields.flatMap((f) => f.referenceClassName ?? []),
    ];
    for (const list of names) {
      const key = list.toLowerCase();
      const set = classLists.get(key) ?? new Set<string>();
      set.add(cls.name.toLowerCase());
      classLists.set(key, set);
    }
  }

  for (const obj of model.objects) {
    const cls = schema.classes[obj.className.toLowerCase()];
    if (!cls) continue;
    obj.fields.forEach((value, i) => {
      const fs = fieldSchema(cls, i);
      if (!fs?.reference || !value) return;
      for (const list of fs.reference) register(list, value.toLowerCase(), obj.id);
    });
  }

  for (const obj of model.objects) {
    const cls = schema.classes[obj.className.toLowerCase()];
    if (!cls) continue;
    obj.fields.forEach((value, i) => {
      const fs = fieldSchema(cls, i);
      if (!fs?.objectList || !value) return;
      const wanted = value.toLowerCase();
      const targets = new Set<number>();
      let isClassName = false;
      for (const list of fs.objectList) {
        const key = list.toLowerCase();
        for (const id of lists.get(key)?.get(wanted) ?? []) targets.add(id);
        if (classLists.get(key)?.has(wanted)) isClassName = true;
      }
      targets.delete(obj.id);
      if (targets.size === 0) {
        // A name that refers to itself (e.g. an interzone surface whose other
        // side is itself) is valid.
        if (
          isClassName ||
          BUILT_IN_NAMES.has(wanted) ||
          selfReference(obj, fs.objectList, lists, wanted)
        ) {
          return;
        }
        broken.push({
          objectId: obj.id,
          field: i,
          fieldName: fs.name,
          value,
          lists: fs.objectList,
        });
        return;
      }
      for (const to of targets) {
        const edge = { from: obj.id, field: i, to };
        push(uses, obj.id, edge);
        push(usedBy, to, edge);
      }
    });
  }

  // Duplicate names inside a class (first field is a referenced name).
  for (const [key, ids] of model.byClass) {
    const cls = schema.classes[key];
    if (!cls?.fields[0]?.reference) continue;
    const seen = new Map<string, number[]>();
    for (const id of ids) {
      const name = (model.objects[id] as IdfObject).fields[0]?.toLowerCase();
      if (!name) continue;
      const list = seen.get(name) ?? [];
      list.push(id);
      seen.set(name, list);
    }
    for (const list of seen.values()) {
      if (list.length > 1) {
        const first = model.objects[list[0] as number] as IdfObject;
        duplicates.push({ className: cls.name, name: first.fields[0] ?? '', objectIds: list });
      }
    }
  }

  return { uses, usedBy, broken, duplicates };
}

function selfReference(
  obj: IdfObject,
  objectLists: string[],
  lists: Map<string, Map<string, number[]>>,
  wanted: string,
): boolean {
  return objectLists.some((l) => lists.get(l.toLowerCase())?.get(wanted)?.includes(obj.id));
}

function push(map: Map<number, RefEdge[]>, key: number, edge: RefEdge) {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}
