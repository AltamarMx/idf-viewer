/**
 * A field as the views show it: its value (or the IDD default when blank), its
 * units and the object it names.
 */
import type { IdfObject } from '../parser/idf';
import type { FieldReader } from './reader';
import type { ReferenceIndex } from './references';

export interface DescribedField {
  label: string;
  /** IDD field name, when the label is shorter. */
  fieldName?: string;
  value: string;
  units?: string;
  /** For ZoneLevel control: the value comes from the surface or from its zone. */
  from?: 'surface' | 'zone';
  /** The field is blank and the IDD default applies. */
  defaulted?: boolean;
  /** Object named by the value (schedule, curve, node…). */
  refId?: number;
  /** The setting in effect does not use this value. */
  unused?: boolean;
  /** What a blank value means, e.g. "always available" for a schedule. */
  blank?: string;
  /** The value is the IDD default, written or not (e.g. a limit of 100 °C). */
  isDefault?: boolean;
}

export function describeField(
  obj: IdfObject,
  r: FieldReader,
  references: ReferenceIndex,
  name: string | undefined,
  label?: string,
): DescribedField | undefined {
  if (!name || !r.has(name)) return undefined;
  const raw = r.str(name);
  const value = raw || r.strOr(name);
  const index = r.indexOf(name) as number;
  const def = r.cls?.fields[index]?.default;
  const isDefault =
    def !== undefined &&
    (typeof def === 'number'
      ? Number(value) === def
      : value.toLowerCase() === String(def).toLowerCase());
  const refId = raw ? references.uses.get(obj.id)?.find((e) => e.field === index)?.to : undefined;
  return {
    label: label ?? name,
    fieldName: label ? name : undefined,
    value,
    units: r.units(name),
    defaulted: !raw && value !== '',
    refId,
    isDefault,
  };
}
