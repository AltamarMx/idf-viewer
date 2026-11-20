import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ClassTable } from '../../core/session';
import { formatInt } from '../../ui/format';
import { idf } from '../../worker/client';

interface Props {
  classKey: string;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

const ROW_HEIGHT = 28;
const COLUMN_WIDTH = 150;
const NAME_WIDTH = 220;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return collator.compare(a, b);
}

/** All objects of a class as a spreadsheet (B3): sortable, filterable, only visible rows drawn. */
export function ClassTableView({ classKey, selectedId, onSelect }: Props) {
  const [table, setTable] = useState<ClassTable | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ column: number; desc: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setTable(null);
    setFilter('');
    setSort(null);
    idf.classTable(classKey).then((t) => {
      if (!cancelled) setTable(t);
    });
    return () => {
      cancelled = true;
    };
  }, [classKey]);

  const rows = useMemo(() => {
    if (!table) return [];
    const wanted = filter.trim().toLowerCase();
    let list = wanted
      ? table.rows.filter((r) => r.values.some((v) => v.toLowerCase().includes(wanted)))
      : table.rows;
    if (sort) {
      const k = sort.column;
      list = [...list].sort(
        (a, b) => compare(a.values[k] ?? '', b.values[k] ?? '') * (sort.desc ? -1 : 1),
      );
    }
    return list;
  }, [table, filter, sort]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Bring the selected object into view.
  useEffect(() => {
    if (selectedId === null) return;
    const index = rows.findIndex((r) => r.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [selectedId, rows, virtualizer]);

  if (!table) return <div className="content count">Loading…</div>;

  const widths = table.columns.map((_, i) => (i === 0 ? NAME_WIDTH : COLUMN_WIDTH));
  const totalWidth = 60 + widths.reduce((a, b) => a + b, 0);
  const template = `60px ${widths.map((w) => `${w}px`).join(' ')}`;

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <strong>{table.className}</strong>
        <span className="count">
          {formatInt(rows.length)}
          {rows.length !== table.rows.length ? ` of ${formatInt(table.rows.length)}` : ''} objects
        </span>
        <input
          type="search"
          placeholder="Filter rows"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter rows"
        />
        {table.truncatedColumns > 0 && (
          <span className="count">{table.truncatedColumns} more columns not shown</span>
        )}
      </div>
      <div ref={scrollRef} className="table-scroll">
        <div className="table-header" style={{ gridTemplateColumns: template, width: totalWidth }}>
          <div className="cell head">Line</div>
          {table.columns.map((name, i) => (
            <button
              type="button"
              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
              key={i}
              className="cell head"
              title={`Sort by ${name}`}
              onClick={() =>
                setSort((s) =>
                  s?.column === i
                    ? s.desc
                      ? null
                      : { column: i, desc: true }
                    : { column: i, desc: false },
                )
              }
            >
              {name}
              {sort?.column === i ? (sort.desc ? ' ▼' : ' ▲') : ''}
            </button>
          ))}
        </div>
        <div
          style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <button
                type="button"
                key={row.id}
                className={`table-row${row.id === selectedId ? ' selected' : ''}`}
                style={{
                  gridTemplateColumns: template,
                  transform: `translateY(${item.start}px)`,
                  height: ROW_HEIGHT,
                  width: totalWidth,
                }}
                onClick={() => onSelect(row.id)}
              >
                <span className="cell count">{row.line}</span>
                {table.columns.map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                  <span key={i} className="cell" title={row.values[i]}>
                    {row.values[i] ?? ''}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
