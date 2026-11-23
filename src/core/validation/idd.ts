/**
 * Checks against the IDD of the file's version (H3) and objects that nothing
 * uses (H4). They follow what EnergyPlus checks when it reads the input:
 *
 * - a required field that is blank and has no default;
 * - a number field that is not a number, or "autosize"/"autocalculate" where
 *   the field accepts neither (EnergyPlus takes either word where it accepts
 *   one), an integer field with decimals, and values out of the IDD minimum
 *   and maximum;
 * - a choice field whose value is not one of its options (except the day
 *   types of Schedule:Week:Compact, which take "For:" and several types);
 * - more than one object of a unique class, and missing required objects
 *   (Building and GlobalGeometryRules);
 * - fields beyond the last one the class defines (non-extensible classes).
 *
 * Unused objects: materials, constructions, schedules and curves that no other
 * object names. Names used by EMS sensors and actuators or by output requests
 * count as uses.
 */
import type { IdfModel } from '../model/model';
import { objectName } from '../model/model';
import { toNumber } from '../model/reader';
import type { ReferenceIndex } from '../model/references';
import type { IdfObject } from '../parser/idf';
import { fieldSchema } from '../schema/fields';
import type { ClassSchema, FieldSchema, Schema } from '../schema/types';
import type { Resolution } from '../schema/version';
import type { Problem } from './problems';

const MAX_KEYS_LISTED = 8;

const quote = (value: string) => `"${value}"`;

function formatLimit(n: number): string {
  return String(n);
}

function checkValue(fs: FieldSchema, value: string): string | null {
  const lower = value.toLowerCase();
  if (fs.type === 'real' || fs.type === 'integer') {
    // EnergyPlus takes either word where the field accepts one of them.
    if (lower === 'autosize' || lower === 'autocalculate') {
      return fs.autosizable || fs.autocalculatable ? null : `${quote(value)} is not allowed here`;
    }
    const n = toNumber(value);
    if (n === undefined) return `must be a number, not ${quote(value)}`;
    if (fs.type === 'integer' && !Number.isInteger(n))
      return `must be a whole number, not ${value}`;
    if (fs.min !== undefined && (fs.minExclusive ? n <= fs.min : n < fs.min)) {
      return `is ${value}; it must be ${fs.minExclusive ? 'greater than' : 'at least'} ${formatLimit(fs.min)}`;
    }
    if (fs.max !== undefined && (fs.maxExclusive ? n >= fs.max : n > fs.max)) {
      return `is ${value}; it must be ${fs.maxExclusive ? 'less than' : 'at most'} ${formatLimit(fs.max)}`;
    }
    return null;
  }
  if (fs.type === 'choice' && fs.keys && fs.keys.length > 0) {
    if (fs.keys.some((k) => k.toLowerCase() === lower)) return null;
    const keys = fs.keys.slice(0, MAX_KEYS_LISTED).join(', ');
    const more = fs.keys.length > MAX_KEYS_LISTED ? ', …' : '';
    return `${quote(value)} is not one of its options (${keys}${more})`;
  }
  return null;
}

/** Last field index that is required and has no default, or -1. */
function lastRequired(cls: ClassSchema): number {
  let last = -1;
  cls.fields.forEach((f, i) => {
    if (f.required && f.default === undefined) last = i;
  });
  return last;
}

export function iddProblems(
  model: IdfModel,
  schema: Schema | undefined,
  resolution: Resolution,
): Problem[] {
  const problems: Problem[] = [];
  if (!schema || resolution.kind === 'none') return problems;
  if (resolution.kind === 'nearest') {
    problems.push({
      severity: 'info',
      category: 'Field',
      message: `Field values are not checked: there is no IDD for EnergyPlus ${resolution.fileVersion}.`,
    });
    return problems;
  }
  const version = resolution.schemaVersion;
  const lastRequiredByClass = new Map<string, number>();

  for (const [key, ids] of model.byClass) {
    const cls = schema.classes[key];
    if (!cls) continue; // reported as an unknown class
    const first = model.objects[ids[0] as number] as IdfObject;

    if (cls.obsolete) {
      problems.push({
        severity: 'warning',
        category: 'Object',
        message: `${cls.name} is obsolete in EnergyPlus ${version}${typeof cls.obsolete === 'string' ? `: ${cls.obsolete}` : ''}.`,
        objectId: first.id,
        line: first.line,
      });
    }
    if (cls.unique && ids.length > 1) {
      for (const id of ids.slice(1)) {
        const obj = model.objects[id] as IdfObject;
        problems.push({
          severity: 'error',
          category: 'Object',
          message: `Only one ${cls.name} is allowed; the file has ${ids.length}.`,
          objectId: id,
          line: obj.line,
        });
      }
    }

    let required = lastRequiredByClass.get(key);
    if (required === undefined) {
      required = lastRequired(cls);
      lastRequiredByClass.set(key, required);
    }
    for (const id of ids) {
      const obj = model.objects[id] as IdfObject;
      const name = objectName(obj, cls);
      const who = name ? `${cls.name} "${name}"` : cls.name;
      const count = Math.max(obj.fields.length, required + 1);
      for (let i = 0; i < count; i++) {
        const value = (obj.fields[i] ?? '').trim();
        const line = obj.fieldLines[i] ?? obj.line;
        const fs = fieldSchema(cls, i);
        if (!fs) {
          if (value) {
            problems.push({
              severity: 'warning',
              category: 'Field',
              message: `${who} has ${obj.fields.length} fields; EnergyPlus ${version} defines ${cls.fields.length} for this class.`,
              objectId: id,
              line,
            });
            break;
          }
          continue;
        }
        if (!value) {
          if (fs.required && fs.default === undefined && i < cls.fields.length) {
            problems.push({
              severity: 'error',
              category: 'Field',
              message: `${who}: ${fs.name} is required and blank.`,
              objectId: id,
              line,
            });
          }
          continue;
        }
        const free = key === 'schedule:week:compact' && /^DayType List/.test(fs.name);
        const issue = free ? null : checkValue(fs, value);
        if (issue) {
          problems.push({
            severity: 'error',
            category: 'Field',
            message: `${who}: ${fs.name} ${issue}.`,
            objectId: id,
            line,
          });
        } else if (fs.deprecated) {
          problems.push({
            severity: 'info',
            category: 'Field',
            message: `${who}: ${fs.name} is deprecated in EnergyPlus ${version}.`,
            objectId: id,
            line,
          });
        }
      }
    }
  }

  for (const [key, cls] of Object.entries(schema.classes)) {
    if (cls.required && model.ofClass(key).length === 0) {
      problems.push({
        severity: 'error',
        category: 'Object',
        message: `The file has no ${cls.name}; EnergyPlus requires one.`,
      });
    }
  }
  return problems;
}

/** Classes whose unused objects are reported, by kind. */
const UNUSED_KINDS: { kind: string; match: (cls: string) => boolean }[] = [
  {
    kind: 'Material',
    match: (c) => c === 'material' || c.startsWith('material:'),
  },
  {
    kind: 'Material',
    match: (c) => c.startsWith('windowmaterial:'),
  },
  { kind: 'Construction', match: (c) => c === 'construction' || c.startsWith('construction:') },
  {
    kind: 'Schedule',
    match: (c) => c.startsWith('schedule:') && c !== 'schedule:week:compact:sublist',
  },
  {
    kind: 'Curve',
    match: (c) =>
      c.startsWith('curve:') ||
      c === 'table:lookup' ||
      c === 'table:oneindependentvariable' ||
      c === 'table:twoindependentvariables' ||
      c === 'table:multivariablelookup',
  },
];

/** Classes whose names count as uses although they are not object references. */
const NAME_USERS: { cls: string; field: RegExp }[] = [
  { cls: 'energymanagementsystem:sensor', field: /Key Name$/ },
  { cls: 'energymanagementsystem:actuator', field: /^Actuated Component Unique Name$/ },
  {
    cls: 'energymanagementsystem:curveortableindexvariable',
    field: /^Curve or Table Object Name$/,
  },
  { cls: 'output:variable', field: /^Key Value$/ },
];

export function unusedProblems(
  model: IdfModel,
  schema: Schema | undefined,
  references: ReferenceIndex,
): Problem[] {
  const problems: Problem[] = [];
  if (!schema) return problems;

  const namedElsewhere = new Set<string>();
  for (const { cls, field } of NAME_USERS) {
    const c = schema.classes[cls];
    if (!c) continue;
    const indices = c.fields.map((f, i) => (field.test(f.name) ? i : -1)).filter((i) => i >= 0);
    for (const obj of model.ofClass(cls)) {
      for (const i of indices) {
        const value = (obj.fields[i] ?? '').trim().toLowerCase();
        if (value) namedElsewhere.add(value);
      }
    }
  }

  for (const [key, ids] of model.byClass) {
    const kind = UNUSED_KINDS.find((k) => k.match(key))?.kind;
    const cls = schema.classes[key];
    if (!kind || !cls) continue;
    for (const id of ids) {
      const obj = model.objects[id] as IdfObject;
      const name = objectName(obj, cls);
      if (!name || namedElsewhere.has(name.toLowerCase())) continue;
      const users = (references.usedBy.get(id) ?? []).filter((edge) => {
        const from = (model.objects[edge.from] as IdfObject).className.toLowerCase();
        // A material property alone does not put the material in a construction.
        return !(kind === 'Material' && from.startsWith('materialproperty'));
      });
      if (users.length > 0) continue;
      problems.push({
        severity: 'info',
        category: 'Unused',
        message: `${kind} "${name}" (${cls.name}) is not used by any object.`,
        objectId: id,
        line: obj.line,
      });
    }
  }
  return problems;
}
