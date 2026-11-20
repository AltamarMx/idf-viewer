import { useMemo } from 'react';
import type { FileSummary } from '../../core/session';
import { formatBytes, formatInt } from '../../ui/format';

/** File facts, version used and objects per group. D1 builds on this in phase 1. */
export function FileOverview({ summary }: { summary: FileSummary }) {
  const r = summary.resolution;
  const groups = useMemo(() => {
    const map = new Map<string, { classes: number; objects: number }>();
    for (const cls of summary.classes) {
      const entry = map.get(cls.group) ?? { classes: 0, objects: 0 };
      entry.classes++;
      entry.objects += cls.count;
      map.set(cls.group, entry);
    }
    return [...map.entries()];
  }, [summary]);

  return (
    <div className="content">
      <h2>{summary.fileName}</h2>
      {r.kind === 'nearest' || r.kind === 'none' ? (
        <div className="notice warn">{r.message}</div>
      ) : (
        r.message && <div className="notice">{r.message}</div>
      )}

      <div className="facts">
        <Fact label="EnergyPlus version" value={r.fileVersion ?? '—'} />
        <Fact label="Schema used" value={r.kind === 'none' ? 'none' : r.schemaVersion} />
        <Fact label="Objects" value={formatInt(summary.objectCount)} />
        <Fact label="Classes" value={formatInt(summary.classes.length)} />
        <Fact label="Lines" value={formatInt(summary.lineCount)} />
        <Fact label="Size" value={formatBytes(summary.size)} />
        <Fact label="Encoding" value={summary.encoding.toUpperCase()} />
      </div>

      {summary.warnings.length > 0 && (
        <>
          <h3>Reading warnings</h3>
          {summary.warnings.map((w) => (
            <div key={`${w.line}:${w.message}`} className="notice warn">
              Line {w.line}: {w.message}
            </div>
          ))}
        </>
      )}

      <h3>Objects by group</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Group</th>
            <th className="num">Classes</th>
            <th className="num">Objects</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, entry]) => (
            <tr key={group}>
              <td>{group}</td>
              <td className="num">{formatInt(entry.classes)}</td>
              <td className="num">{formatInt(entry.objects)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
