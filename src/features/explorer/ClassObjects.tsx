import { useCallback, useEffect, useState } from 'react';
import type { FileSummary, ObjectView } from '../../core/session';
import { formatInt } from '../../ui/format';
import { classObjects } from '../../worker/client';

const PAGE = 50;

interface Props {
  classKey: string;
  summary: FileSummary;
}

/** Objects of one class with their field names for this version. Replaced by B2/B3 in phase 1. */
export function ClassObjects({ classKey, summary }: Props) {
  const [objects, setObjects] = useState<ObjectView[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = summary.classes.find((c) => c.key === classKey);

  const load = useCallback(
    (offset: number) => {
      classObjects(classKey, offset, PAGE)
        .then((page) => {
          setTotal(page.total);
          setObjects((current) => (offset === 0 ? page.objects : [...current, ...page.objects]));
        })
        .catch((e: unknown) => setError(String(e)));
    },
    [classKey],
  );

  useEffect(() => load(0), [load]);

  return (
    <div className="content">
      <h2>
        {info?.name ?? classKey} <span className="count">({formatInt(info?.count ?? 0)})</span>
      </h2>
      {info && !info.known && (
        <div className="notice warn">
          This class is not in the schema of this EnergyPlus version, so its fields have no names.
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      {objects.map((obj) => (
        <section key={obj.id} className="object">
          <div className="object-head">
            <strong>{obj.name ?? obj.className}</strong>
            <span className="line">line {obj.line}</span>
          </div>
          <table className="grid">
            <tbody>
              {obj.fields.map((field, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fields are positional
                <tr key={i}>
                  <td>{field.name}</td>
                  <td className="value">
                    {field.value === '' ? (
                      <span className="empty-value">(blank)</span>
                    ) : (
                      field.value
                    )}
                  </td>
                  <td className="units">{field.units ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {total !== null && objects.length < total && (
        <button type="button" className="btn" onClick={() => load(objects.length)}>
          Show {Math.min(PAGE, total - objects.length)} more of {formatInt(total - objects.length)}
        </button>
      )}
    </div>
  );
}
