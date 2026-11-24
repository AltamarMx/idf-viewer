/**
 * Outputs the file asks EnergyPlus for (D6): variables, meters, tabular
 * reports and output settings, with their reporting frequency.
 */
import { type DescribedField, describeField } from './model/describe';
import type { IdfModel } from './model/model';
import { FieldReader } from './model/reader';
import type { ReferenceIndex } from './model/references';
import type { IdfObject } from './parser/idf';
import { fieldName } from './schema/fields';
import type { Schema } from './schema/types';

export interface FrequencyValue {
  /** As written, or the IDD default when blank. */
  value: string;
  defaulted: boolean;
}

export interface OutputVariableRow {
  id: number;
  key: string;
  name: string;
  frequency: FrequencyValue;
  schedule?: DescribedField;
}

export interface OutputMeterRow {
  id: number;
  className: string;
  name: string;
  frequency: FrequencyValue;
}

export interface MonthlyTableRow {
  id: number;
  name: string;
  digits?: string;
  items: { name: string; aggregation: string }[];
}

export interface OtherOutputRow {
  id: number;
  className: string;
  fields: { label: string; value: string }[];
}

export interface OutputsView {
  variables: OutputVariableRow[];
  meters: OutputMeterRow[];
  summaryReports: { id: number; reports: string[] }[];
  monthly: MonthlyTableRow[];
  /** Other output requests and settings (SQLite, table style, files, drawings…). */
  other: OtherOutputRow[];
  /** Variables and meters per reporting frequency, in IDD order. */
  byFrequency: { frequency: string; variables: number; meters: number }[];
}

const METER_CLASSES = [
  'output:meter',
  'output:meter:meterfileonly',
  'output:meter:cumulative',
  'output:meter:cumulative:meterfileonly',
];

const HANDLED = new Set([
  'output:variable',
  ...METER_CLASSES,
  'output:table:summaryreports',
  'output:table:monthly',
  // Definitions rather than requests.
  'meter:custom',
  'meter:customdecrement',
  'environmentalimpactfactors',
  'fuelfactors',
]);

const MAX_OTHER_FIELDS = 40;

export function outputsView(
  model: IdfModel,
  schema: Schema | undefined,
  references: ReferenceIndex,
): OutputsView {
  const view: OutputsView = {
    variables: [],
    meters: [],
    summaryReports: [],
    monthly: [],
    other: [],
    byFrequency: [],
  };
  if (!schema) return view;
  const reader = (obj: IdfObject) =>
    new FieldReader(obj, schema.classes[obj.className.toLowerCase()]);

  // Frequencies as the IDD spells them, so "hourly" and "Hourly" count together.
  const frequencyField = schema.classes['output:variable']?.fields.find(
    (f) => f.name === 'Reporting Frequency',
  );
  const keys = frequencyField?.keys ?? [];
  const frequency = (r: FieldReader): FrequencyValue => {
    const raw = r.str('Reporting Frequency');
    const value = raw || r.strOr('Reporting Frequency');
    const canonical = keys.find((k) => k.toLowerCase() === value.toLowerCase()) ?? value;
    return { value: canonical, defaulted: !raw };
  };

  for (const obj of model.ofClass('output:variable')) {
    const r = reader(obj);
    view.variables.push({
      id: obj.id,
      key: r.strOr('Key Value') || '*',
      name: r.str('Variable Name'),
      frequency: frequency(r),
      schedule: r.str('Schedule Name')
        ? describeField(obj, r, references, 'Schedule Name')
        : undefined,
    });
  }

  for (const key of METER_CLASSES) {
    for (const obj of model.ofClass(key)) {
      const r = reader(obj);
      view.meters.push({
        id: obj.id,
        className: obj.className,
        // "Name" until 8.x, "Key Name" since 9.0.
        name: r.str(r.find(/^(Key )?Name$/) ?? 'Key Name'),
        frequency: frequency(r),
      });
    }
  }

  for (const obj of model.ofClass('output:table:summaryreports')) {
    view.summaryReports.push({
      id: obj.id,
      reports: obj.fields.map((f) => f.trim()).filter(Boolean),
    });
  }

  for (const obj of model.ofClass('output:table:monthly')) {
    const r = reader(obj);
    const values = r.extensible();
    const items: MonthlyTableRow['items'] = [];
    for (let i = 0; i < values.length; i += 2) {
      const name = (values[i] ?? '').trim();
      if (name) items.push({ name, aggregation: (values[i + 1] ?? '').trim() });
    }
    view.monthly.push({
      id: obj.id,
      name: r.str('Name'),
      digits: r.str('Digits After Decimal') || undefined,
      items,
    });
  }

  for (const [key, ids] of model.byClass) {
    const cls = schema.classes[key];
    if (cls?.group !== 'Output Reporting' || HANDLED.has(key)) continue;
    for (const id of ids) {
      const obj = model.objects[id] as IdfObject;
      const fields = obj.fields
        .map((value, i) => ({ label: fieldName(cls, i), value: value.trim() }))
        .filter((f) => f.value)
        .slice(0, MAX_OTHER_FIELDS);
      view.other.push({ id, className: obj.className, fields });
    }
  }

  const counts = new Map<string, { variables: number; meters: number }>();
  const count = (f: string) => {
    const entry = counts.get(f) ?? { variables: 0, meters: 0 };
    counts.set(f, entry);
    return entry;
  };
  for (const v of view.variables) count(v.frequency.value).variables++;
  for (const m of view.meters) count(m.frequency.value).meters++;
  const order = (f: string) => {
    const i = keys.indexOf(f);
    return i < 0 ? keys.length : i;
  };
  view.byFrequency = [...counts]
    .map(([f, c]) => ({ frequency: f, ...c }))
    .sort((a, b) => order(a.frequency) - order(b.frequency));
  return view;
}
