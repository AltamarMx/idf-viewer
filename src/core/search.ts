/** Global search (B4) over class names, object names and field values. */
import type { IdfModel } from './model/model';
import { fieldName } from './schema/fields';
import type { Schema } from './schema/types';

export interface SearchHit {
  id: number;
  className: string;
  name?: string;
  line: number;
  match: 'name' | 'class' | 'value';
  fieldName?: string;
  value?: string;
}

export function search(
  model: IdfModel,
  schema: Schema | undefined,
  query: string,
  limit = 100,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [number, SearchHit][] = [];
  for (const obj of model.objects) {
    const cls = schema?.classes[obj.className.toLowerCase()];
    const className = cls?.name ?? obj.className;
    const named = Boolean(cls?.fields[0]?.reference) || /name$/i.test(cls?.fields[0]?.name ?? '');
    const name = named ? obj.fields[0] : undefined;
    const base = { id: obj.id, className, name, line: obj.line };
    const lowerName = name?.toLowerCase();
    if (lowerName?.includes(q)) {
      const score = lowerName === q ? 0 : lowerName.startsWith(q) ? 1 : 2;
      scored.push([score, { ...base, match: 'name' }]);
      continue;
    }
    if (className.toLowerCase().includes(q)) {
      scored.push([3, { ...base, match: 'class' }]);
      continue;
    }
    const i = obj.fields.findIndex((v, k) => (k > 0 || !named) && v.toLowerCase().includes(q));
    if (i >= 0) {
      scored.push([
        4,
        { ...base, match: 'value', fieldName: fieldName(cls, i), value: obj.fields[i] },
      ]);
    }
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
  return scored.slice(0, limit).map(([, hit]) => hit);
}
