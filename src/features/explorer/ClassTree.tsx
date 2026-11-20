import { useMemo, useState } from 'react';
import { type ClassSummary, UNKNOWN_GROUP } from '../../core/model/model';
import { formatInt } from '../../ui/format';

interface Props {
  classes: ClassSummary[];
  selected: string | null;
  onSelect: (key: string) => void;
}

/** Classes in the file grouped by IDD group, with object counts (first step of B1). */
export function ClassTree({ classes, selected, onSelect }: Props) {
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const wanted = filter.trim().toLowerCase();
    const map = new Map<string, ClassSummary[]>();
    for (const cls of classes) {
      if (wanted && !cls.name.toLowerCase().includes(wanted)) continue;
      const list = map.get(cls.group) ?? [];
      list.push(cls);
      map.set(cls.group, list);
    }
    return [...map.entries()];
  }, [classes, filter]);

  return (
    <nav aria-label="Classes">
      <div className="tree-filter">
        <input
          type="search"
          placeholder={`Filter ${classes.length} classes`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter classes"
        />
      </div>
      {groups.map(([group, list]) => (
        <details
          key={group}
          className={`tree-group${group === UNKNOWN_GROUP ? ' unknown' : ''}`}
          open
        >
          <summary>{group}</summary>
          {list.map((cls) => (
            <button
              type="button"
              key={cls.key}
              className={`class-row${cls.key === selected ? ' selected' : ''}`}
              onClick={() => onSelect(cls.key)}
              title={cls.known ? cls.name : `${cls.name} is not in the schema of this version`}
            >
              <span className="name">{cls.name}</span>
              <span className="count">{formatInt(cls.count)}</span>
            </button>
          ))}
        </details>
      ))}
      {groups.length === 0 && <p className="content count">No classes match.</p>}
    </nav>
  );
}
