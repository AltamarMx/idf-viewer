import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../../core/search';
import { idf } from '../../worker/client';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (id: number) => void;
}

/** Global search (B4): names, classes and field values. Opened with Ctrl/⌘+K. */
export function SearchDialog({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      idf.search(query, 100).then((h) => {
        setHits(h);
        setActive(0);
      });
    }, 120);
    return () => clearTimeout(handle);
  }, [query, open]);

  if (!open) return null;

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onSelect(hit.id);
    onClose();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled on the input
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes the dialog
    <div className="overlay search-overlay" onClick={onClose}>
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="search"
          placeholder="Search names, classes and values"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') choose(hits[active]);
          }}
          aria-label="Search"
        />
        <ul className="search-results">
          {hits.map((hit, i) => (
            <li key={hit.id}>
              <button
                type="button"
                className={i === active ? 'active' : undefined}
                aria-current={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(hit)}
              >
                <span className="hit-name">{hit.name ?? hit.className}</span>
                <span className="count">
                  {hit.className}
                  {hit.match === 'value' ? ` · ${hit.fieldName}: ${hit.value}` : ''} · line{' '}
                  {hit.line}
                </span>
              </button>
            </li>
          ))}
          {query.trim() && hits.length === 0 && <li className="count empty">No matches.</li>}
        </ul>
        <div className="count search-foot">↑↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}
