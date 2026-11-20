/**
 * Problems panel (H2): reading warnings, version fallback, unknown classes,
 * broken references and duplicate names (H1), and geometry warnings.
 * A quick pre-check; it does not replace EnergyPlus' own validation.
 */
import type { GeometryWarning } from '../geometry/build';
import type { ClassSummary, IdfModel } from '../model/model';
import type { ReferenceIndex } from '../model/references';
import type { IdfObject, ParseWarning } from '../parser/idf';
import type { Resolution } from '../schema/version';

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  severity: Severity;
  category: 'Reading' | 'Version' | 'Schema' | 'Reference' | 'Duplicate name' | 'Geometry';
  message: string;
  objectId?: number;
  line?: number;
}

export function collectProblems(input: {
  model: IdfModel;
  resolution: Resolution;
  parseWarnings: ParseWarning[];
  classes: ClassSummary[];
  references: ReferenceIndex;
  geometryWarnings: GeometryWarning[];
}): Problem[] {
  const { model } = input;
  const problems: Problem[] = [];
  const objectLine = (id: number) => (model.objects[id] as IdfObject).line;

  for (const w of input.parseWarnings) {
    problems.push({ severity: 'warning', category: 'Reading', message: w.message, line: w.line });
  }

  const r = input.resolution;
  if (r.kind === 'none' || r.kind === 'nearest') {
    problems.push({ severity: 'warning', category: 'Version', message: r.message });
  } else if (r.message) {
    problems.push({ severity: 'info', category: 'Version', message: r.message });
  }

  if (r.kind !== 'none') {
    for (const cls of input.classes) {
      if (cls.known) continue;
      const first = model.ofClass(cls.key)[0];
      problems.push({
        severity: 'warning',
        category: 'Schema',
        message: `Class "${cls.name}" does not exist in EnergyPlus ${r.schemaVersion} (${cls.count} object${cls.count === 1 ? '' : 's'}).`,
        objectId: first?.id,
        line: first?.line,
      });
    }
  }

  for (const b of input.references.broken) {
    problems.push({
      severity: 'error',
      category: 'Reference',
      message: `${b.fieldName} "${b.value}" is not defined in the file.`,
      objectId: b.objectId,
      line: (model.objects[b.objectId] as IdfObject).fieldLines[b.field] ?? objectLine(b.objectId),
    });
  }

  for (const d of input.references.duplicates) {
    for (const id of d.objectIds) {
      problems.push({
        severity: 'error',
        category: 'Duplicate name',
        message: `${d.className} name "${d.name}" is used by ${d.objectIds.length} objects.`,
        objectId: id,
        line: objectLine(id),
      });
    }
  }

  for (const g of input.geometryWarnings) {
    problems.push({
      severity: 'warning',
      category: 'Geometry',
      message: g.message,
      objectId: g.objectId,
      line: objectLine(g.objectId),
    });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return problems.sort(
    (a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0),
  );
}
