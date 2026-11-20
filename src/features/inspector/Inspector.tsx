import { useEffect, useState } from 'react';
import type { ClassDocs } from '../../core/schema/types';
import type { FieldDetail, ObjectDetail, ObjectRef } from '../../core/session';
import { idf } from '../../worker/client';

interface Props {
  id: number | null;
  onSelect: (id: number) => void;
  /** Reports the loaded object so other views can highlight it. */
  onLoaded?: (detail: ObjectDetail | null) => void;
}

/** Object inspector (B2) with references in both directions (B5). */
export function Inspector({ id, onSelect, onLoaded }: Props) {
  const [detail, setDetail] = useState<ObjectDetail | null>(null);
  const [docs, setDocs] = useState<{ classKey: string; docs: ClassDocs | null } | null>(null);
  const [openNote, setOpenNote] = useState<number | null>(null);
  const [showMemo, setShowMemo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setOpenNote(null);
    if (id === null) {
      setDetail(null);
      onLoaded?.(null);
      return;
    }
    idf.inspect(id).then((d) => {
      if (cancelled) return;
      setDetail(d);
      onLoaded?.(d);
    });
    return () => {
      cancelled = true;
    };
  }, [id, onLoaded]);

  const loadDocs = async (classKey: string) => {
    if (docs?.classKey === classKey) return docs.docs;
    const loaded = await idf.help(classKey).catch(() => null);
    setDocs({ classKey, docs: loaded });
    return loaded;
  };

  if (!detail) {
    return (
      <div className="inspector empty">
        <p>Select an object in the table, the 3D view or the search (⌘K) to see its fields here.</p>
      </div>
    );
  }

  const classDocs = docs?.classKey === detail.classKey ? docs.docs : null;

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div className="count">{detail.className}</div>
        <h2>{detail.name ?? detail.className}</h2>
        <div className="count">
          line {detail.line}
          {detail.group ? ` · ${detail.group}` : ''}
          {' · '}
          <button
            type="button"
            className="link"
            onClick={async () => {
              await loadDocs(detail.classKey);
              setShowMemo((v) => !v);
            }}
          >
            {showMemo ? 'hide description' : 'about this class'}
          </button>
        </div>
        {showMemo && <p className="memo">{classDocs?.memo ?? 'No description in the IDD.'}</p>}
        {!detail.known && (
          <div className="notice warn">This class is not in the schema of this version.</div>
        )}
      </div>

      <table className="grid fields">
        <tbody>
          {detail.fields.map((f) => (
            <FieldRow
              key={f.index}
              field={f}
              note={
                openNote === f.index
                  ? (classDocs?.notes?.[String(f.helpIndex)] ?? 'No notes in the IDD.')
                  : null
              }
              onToggleNote={async () => {
                await loadDocs(detail.classKey);
                setOpenNote((current) => (current === f.index ? null : f.index));
              }}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      </table>

      <h3>Used by ({detail.usedBy.length})</h3>
      {detail.usedBy.length === 0 ? (
        <p className="count">No object refers to this one.</p>
      ) : (
        <ul className="ref-list">
          {detail.usedBy.map((u) => (
            <li key={`${u.id}:${u.fieldName}`}>
              <RefLink target={u} onSelect={onSelect} />
              <span className="count"> · {u.fieldName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FieldRow(props: {
  field: FieldDetail;
  note: string | null;
  onToggleNote: () => void;
  onSelect: (id: number) => void;
}) {
  const { field: f } = props;
  const range = rangeText(f);
  return (
    <>
      <tr className={f.omitted ? 'omitted' : undefined}>
        <td className="field-name">
          {f.name}
          {f.required && (
            <span className="required" title="Required field">
              {' '}
              *
            </span>
          )}
          <button
            type="button"
            className="help"
            onClick={props.onToggleNote}
            aria-label={`Help for ${f.name}`}
          >
            ?
          </button>
        </td>
        <td className="value">
          {f.value !== '' ? (
            f.targets.length > 0 ? (
              f.targets.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ', '}
                  <RefLink
                    target={t}
                    onSelect={props.onSelect}
                    label={i === 0 ? f.value : undefined}
                  />
                </span>
              ))
            ) : (
              <span
                className={f.broken ? 'broken' : undefined}
                title={f.broken ? 'Not defined in the file' : undefined}
              >
                {f.value}
              </span>
            )
          ) : (
            <span className="empty-value">
              {f.usesDefault ? `default: ${f.defaultValue}` : f.omitted ? '(not set)' : '(blank)'}
            </span>
          )}
          {f.value !== '' &&
            f.defaultValue !== undefined &&
            f.value.toLowerCase() === f.defaultValue.toLowerCase() && (
              <span className="count"> (= default)</span>
            )}
        </td>
        <td className="units">{f.units ?? ''}</td>
      </tr>
      {props.note !== null && (
        <tr className="note-row">
          <td colSpan={3}>
            <p className="memo">{props.note}</p>
            <p className="count">
              {f.type ? `Type: ${f.type}` : ''}
              {range ? ` · Range: ${range}` : ''}
              {f.defaultValue !== undefined ? ` · Default: ${f.defaultValue}` : ''}
              {f.keys ? ` · Options: ${f.keys.join(', ')}` : ''}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function rangeText(f: FieldDetail): string {
  const parts: string[] = [];
  if (f.min !== undefined) parts.push(`${f.minExclusive ? '>' : '≥'} ${f.min}`);
  if (f.max !== undefined) parts.push(`${f.maxExclusive ? '<' : '≤'} ${f.max}`);
  return parts.join(' and ');
}

function RefLink({
  target,
  onSelect,
  label,
}: {
  target: ObjectRef;
  onSelect: (id: number) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="ref"
      onClick={() => onSelect(target.id)}
      title={`${target.className} ${target.name ?? ''}`}
    >
      {label ?? target.name ?? target.className}
      {!label && <span className="count"> ({target.className})</span>}
    </button>
  );
}
