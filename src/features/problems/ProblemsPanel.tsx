import { useEffect, useMemo, useState } from 'react';
import type { Problem, Severity } from '../../core/validation/problems';
import { formatInt } from '../../ui/format';
import { idf } from '../../worker/client';

interface Props {
  onSelect: (id: number) => void;
}

const SEVERITIES: Severity[] = ['error', 'warning', 'info'];
const LABEL: Record<Severity, string> = { error: 'Errors', warning: 'Warnings', info: 'Notes' };

/** Problems panel (H2). A quick pre-check, not EnergyPlus' own validation. */
export function ProblemsPanel({ onSelect }: Props) {
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [shown, setShown] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    idf.problems().then(setProblems);
  }, []);

  const categories = useMemo(
    () => [...new Set((problems ?? []).map((p) => p.category))],
    [problems],
  );
  const list = useMemo(() => {
    const wanted = text.trim().toLowerCase();
    return (problems ?? []).filter(
      (p) =>
        shown.has(p.severity) &&
        (!category || p.category === category) &&
        (!wanted || p.message.toLowerCase().includes(wanted)),
    );
  }, [problems, shown, category, text]);

  if (!problems) return <div className="content count">Loading…</div>;

  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s, problems.filter((p) => p.severity === s).length]),
  );

  return (
    <div className="content wide">
      <div className="problems-toolbar">
        {SEVERITIES.map((s) => (
          <label key={s} className={`chip ${s}`}>
            <input
              type="checkbox"
              checked={shown.has(s)}
              onChange={() =>
                setShown((current) => {
                  const next = new Set(current);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  return next;
                })
              }
            />
            {LABEL[s]} ({formatInt(counts[s] ?? 0)})
          </label>
        ))}
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Filter"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Filter problems"
        />
      </div>
      <p className="count">
        A quick check of the input. It does not replace the validation EnergyPlus does when it runs.
      </p>
      {problems.length === 0 && <div className="notice">No problems found.</div>}
      <table className="grid problems">
        <tbody>
          {list.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: problems have no id
            <tr key={i} className={p.objectId !== undefined ? 'clickable' : undefined}>
              <td className={`severity ${p.severity}`}>{p.severity}</td>
              <td className="count">{p.category}</td>
              <td>
                {p.objectId !== undefined ? (
                  <button
                    type="button"
                    className="ref"
                    onClick={() => onSelect(p.objectId as number)}
                  >
                    {p.message}
                  </button>
                ) : (
                  p.message
                )}
              </td>
              <td className="count num">{p.line ? `line ${p.line}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
