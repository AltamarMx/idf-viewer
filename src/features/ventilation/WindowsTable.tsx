import { useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AFN_COMPONENTS } from '../../core/airflow/afn';
import type { OpeningKind, WindowInventory, WindowRow } from '../../core/openings/windows';
import { formatArea, formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';

interface Props {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onShow3D: (id: number) => void;
  /** Opens the AirflowNetwork card of a surface (L4). */
  onOpenCard: (surface: string) => void;
}

interface Actions {
  select: (id: number) => void;
  openCard: (surface: string) => void;
}

const ROW_HEIGHT = 28;

const KIND_LABELS: Record<OpeningKind, string> = {
  window: 'Window',
  glassdoor: 'Glass door',
  door: 'Door',
  tdd: 'Tubular daylighting',
};

const FACINGS = ['North', 'East', 'South', 'West', 'Roof', 'Floor'] as const;

type AfnFilter = 'all' | 'operable' | 'leakage' | 'none';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const num = (n: number | undefined) => (n === undefined ? '' : formatNumber(n));

interface Column {
  key: string;
  label: string;
  width: number;
  numeric?: boolean;
  title?: string;
  sort: (r: WindowRow) => string | number | undefined;
  render: (r: WindowRow, actions: Actions) => ReactNode;
}

function ref(name: string | undefined, id: number | undefined, select: (id: number) => void) {
  if (!name) return '';
  if (id === undefined) return <span title="Object not found">{name}</span>;
  return (
    <button type="button" className="ref" onClick={() => select(id)} title={name}>
      {name}
    </button>
  );
}

const COLUMNS: Column[] = [
  {
    key: 'type',
    label: 'Type',
    width: 90,
    sort: (r) => KIND_LABELS[r.kind],
    render: (r) => <span title={r.className}>{KIND_LABELS[r.kind]}</span>,
  },
  {
    key: 'zone',
    label: 'Zone',
    width: 150,
    sort: (r) => r.zone,
    render: (r) => r.zone ?? '',
  },
  {
    key: 'base',
    label: 'Host surface',
    width: 170,
    sort: (r) => r.base,
    render: (r, { select }) => ref(r.base, r.baseId, select),
  },
  {
    key: 'facing',
    label: 'Facing',
    width: 100,
    title:
      'North [315°, 45°), East [45°, 135°), South [135°, 225°), West [225°, 315°); Roof when tilt < 60°',
    sort: (r) => r.azimuth,
    render: (r) => (
      <span title={`azimuth ${r.azimuth.toFixed(1)}°, tilt ${r.tilt.toFixed(1)}°`}>
        {r.facing} {r.facing === 'Roof' || r.facing === 'Floor' ? '' : `${r.azimuth.toFixed(0)}°`}
      </span>
    ),
  },
  {
    key: 'size',
    label: 'W × H (m)',
    width: 100,
    numeric: true,
    sort: (r) => r.width,
    render: (r) =>
      r.width !== undefined && r.height !== undefined
        ? `${formatNumber(r.width)} × ${formatNumber(r.height)}`
        : 'not rectangular',
  },
  {
    key: 'sill',
    label: 'Sill (m)',
    width: 70,
    numeric: true,
    title: 'Bottom of the opening above the lowest point of its host wall',
    sort: (r) => r.sill,
    render: (r) => num(r.sill),
  },
  {
    key: 'head',
    label: 'Head (m)',
    width: 70,
    numeric: true,
    title: 'Top of the opening above the lowest point of its host wall',
    sort: (r) => r.head,
    render: (r) => num(r.head),
  },
  {
    key: 'area',
    label: 'Area (m²)',
    width: 80,
    numeric: true,
    title: 'Area of one opening, without frame',
    sort: (r) => r.area,
    render: (r) => formatNumber(r.area),
  },
  {
    key: 'frameArea',
    label: 'Frame (m²)',
    width: 80,
    numeric: true,
    title: 'Frame area of one opening (WindowProperty:FrameAndDivider)',
    sort: (r) => r.frameArea,
    render: (r) => (r.frameArea ? formatNumber(r.frameArea) : ''),
  },
  {
    key: 'mult',
    label: 'Mult.',
    width: 60,
    numeric: true,
    title: 'Window multiplier × zone multiplier',
    sort: (r) => r.multiplier * r.zoneMultiplier,
    render: (r) =>
      r.zoneMultiplier !== 1 ? `${r.multiplier} × ${r.zoneMultiplier}` : String(r.multiplier),
  },
  {
    key: 'total',
    label: 'Total (m²)',
    width: 85,
    numeric: true,
    title: '(Area + frame) × multipliers, as in the EnergyPlus window-wall ratio',
    sort: (r) => r.totalArea,
    render: (r) => formatNumber(r.totalArea),
  },
  {
    key: 'construction',
    label: 'Construction',
    width: 190,
    sort: (r) => r.construction,
    render: (r, { select }) => ref(r.construction, r.constructionId, select),
  },
  {
    key: 'u',
    label: 'U',
    width: 60,
    numeric: true,
    title: 'U-factor (W/m²·K) of WindowMaterial:SimpleGlazingSystem',
    sort: (r) => r.glazing?.u,
    render: (r) => num(r.glazing?.u),
  },
  {
    key: 'shgc',
    label: 'SHGC',
    width: 60,
    numeric: true,
    title: 'Solar heat gain coefficient of WindowMaterial:SimpleGlazingSystem',
    sort: (r) => r.glazing?.shgc,
    render: (r) => num(r.glazing?.shgc),
  },
  {
    key: 'vt',
    label: 'VT',
    width: 55,
    numeric: true,
    title: 'Visible transmittance of WindowMaterial:SimpleGlazingSystem',
    sort: (r) => r.glazing?.vt,
    render: (r) => num(r.glazing?.vt),
  },
  {
    key: 'frame',
    label: 'Frame and divider',
    width: 150,
    sort: (r) => r.frame,
    render: (r, { select }) => ref(r.frame, r.frameId, select),
  },
  {
    key: 'shading',
    label: 'Shading control',
    width: 220,
    sort: (r) => r.shading[0]?.name,
    render: (r, { select }) =>
      r.shading.map((c, i) => (
        <span key={c.id}>
          {i > 0 ? ', ' : ''}
          {ref(c.name, c.id, select)}{' '}
          <span className="count" title={c.controlType}>
            {c.shadingType}
          </span>
        </span>
      )),
  },
  {
    key: 'afn',
    label: 'AFN component',
    width: 190,
    sort: (r) => r.afn?.type,
    render: (r, { openCard }) =>
      r.afn ? (
        <>
          <button
            type="button"
            className={`ref${r.afn.type === 'missing' ? ' warn-text' : ''}`}
            onClick={() => openCard(r.name)}
            title="Open the AirflowNetwork card"
          >
            {r.afn.component}
          </button>{' '}
          <span className="count">
            {r.afn.type === 'missing' ? 'missing' : AFN_COMPONENTS[r.afn.type].label}
          </span>
        </>
      ) : (
        ''
      ),
  },
  {
    key: 'factor',
    label: 'Open. factor',
    width: 85,
    numeric: true,
    title: 'Window/Door Opening Factor, or Crack Factor',
    sort: (r) => r.afn?.factor,
    render: (r) => num(r.afn?.factor),
  },
  {
    key: 'cd',
    label: 'Cd',
    width: 55,
    numeric: true,
    title: 'Discharge coefficient at the maximum opening factor',
    sort: (r) => r.afn?.cd,
    render: (r) => num(r.afn?.cd),
  },
  {
    key: 'control',
    label: 'Vent control',
    width: 120,
    title: 'Ventilation control mode that applies (ZoneLevel takes the zone mode)',
    sort: (r) => r.afn?.controlMode,
    render: (r) =>
      r.afn ? (
        <span
          title={
            r.afn.surfaceMode.toLowerCase() === 'zonelevel'
              ? r.afn.zoneMissing
                ? 'ZoneLevel, but the zone has no AirflowNetwork:MultiZone:Zone'
                : 'From AirflowNetwork:MultiZone:Zone (ZoneLevel)'
              : 'Set on the surface'
          }
        >
          {r.afn.controlMode}
          {r.afn.surfaceMode.toLowerCase() === 'zonelevel' && !r.afn.zoneMissing ? ' (zone)' : ''}
        </span>
      ) : (
        ''
      ),
  },
];

const NAME_WIDTH = 230;

function compare(a: string | number | undefined, b: string | number | undefined): number {
  if (a === undefined || a === '') return b === undefined || b === '' ? 0 : 1;
  if (b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** Windows and doors (L1): sortable, filterable, linked to the inspector and the 3D view. */
export function WindowsTable({ selectedId, onSelect, onShow3D, onOpenCard }: Props) {
  const [inventory, setInventory] = useState<WindowInventory | null>(null);
  const [kind, setKind] = useState<OpeningKind | 'all'>('all');
  const [zone, setZone] = useState('');
  const [facing, setFacing] = useState('');
  const [afnFilter, setAfnFilter] = useState<AfnFilter>('all');
  const [text, setText] = useState('');
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    idf.windows().then(setInventory);
  }, []);

  const all = inventory?.rows ?? [];
  const zones = useMemo(
    () =>
      [...new Set(all.map((r) => r.zone).filter((z): z is string => Boolean(z)))].sort(
        collator.compare,
      ),
    [all],
  );
  const kinds = useMemo(() => new Set(all.map((r) => r.kind)), [all]);

  const rows = useMemo(() => {
    const wanted = text.trim().toLowerCase();
    let list = all.filter(
      (r) =>
        (kind === 'all' || r.kind === kind) &&
        (!zone || r.zone === zone) &&
        (!facing || r.facing === facing) &&
        (afnFilter === 'all' || (afnFilter === 'none' ? !r.afn : r.afn?.role === afnFilter)) &&
        (!wanted ||
          [
            r.name,
            r.base,
            r.construction,
            r.frame,
            ...r.shading.map((c) => c.name),
            r.afn?.component,
          ].some((v) => v?.toLowerCase().includes(wanted))),
    );
    if (sort) {
      const value =
        sort.key === 'name'
          ? (r: WindowRow) => r.name
          : (COLUMNS.find((c) => c.key === sort.key)?.sort ?? (() => undefined));
      list = [...list].sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        // Blanks stay at the bottom in both directions.
        if (va === undefined || va === '' || vb === undefined || vb === '') return compare(va, vb);
        return compare(va, vb) * (sort.desc ? -1 : 1);
      });
    }
    return list;
  }, [all, kind, zone, facing, afnFilter, text, sort]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  useEffect(() => {
    if (selectedId === null) return;
    const index = rows.findIndex((r) => r.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [selectedId, rows, virtualizer]);

  if (!inventory) return <div className="content count">Reading windows…</div>;
  if (all.length === 0) {
    return <div className="content">This file has no windows or doors.</div>;
  }

  const hasAfn = inventory.afn.present || all.some((r) => r.afn);
  const columns = COLUMNS.filter(
    (c) => hasAfn || !['afn', 'factor', 'cd', 'control'].includes(c.key),
  );
  const template = `${NAME_WIDTH}px 44px ${columns.map((c) => `${c.width}px`).join(' ')}`;
  const totalWidth = NAME_WIDTH + 44 + columns.reduce((sum, c) => sum + c.width, 0);
  const shownArea = rows.reduce((sum, r) => sum + r.totalArea, 0);
  const operable = all.filter((r) => r.afn?.role === 'operable').length;

  const header = (key: string, label: string, numeric?: boolean, title?: string) => (
    <button
      type="button"
      key={key}
      className={`cell head${numeric ? ' num' : ''}`}
      title={title ?? `Sort by ${label}`}
      onClick={() =>
        setSort((s) =>
          s?.key === key ? (s.desc ? null : { key, desc: true }) : { key, desc: false },
        )
      }
    >
      {label}
      {sort?.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}
    </button>
  );

  return (
    <div className="table-view windows-view">
      {hasAfn && (
        <div className={`notice ${inventory.afn.active ? '' : 'warn'} windows-notice`}>
          {inventory.afn.active
            ? `AirflowNetwork is on (${inventory.afn.control}). ${formatInt(operable)} of ${formatInt(all.length)} windows and doors are operable openings.`
            : inventory.afn.present
              ? `AirflowNetwork:SimulationControl is ${inventory.afn.control}: EnergyPlus does not run the network, so these AFN settings have no effect.`
              : 'The file has AirflowNetwork surfaces but no AirflowNetwork:SimulationControl: EnergyPlus does not run the network.'}
        </div>
      )}
      <div className="table-toolbar">
        <span className="count">
          {formatInt(rows.length)}
          {rows.length !== all.length ? ` of ${formatInt(all.length)}` : ''} openings ·{' '}
          {formatArea(shownArea)}
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as OpeningKind | 'all')}
          aria-label="Type"
        >
          <option value="all">All types</option>
          {(Object.keys(KIND_LABELS) as OpeningKind[])
            .filter((k) => kinds.has(k))
            .map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
        </select>
        <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
          <option value="">All zones</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <select value={facing} onChange={(e) => setFacing(e.target.value)} aria-label="Facing">
          <option value="">All facings</option>
          {FACINGS.filter((f) => all.some((r) => r.facing === f)).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {hasAfn && (
          <select
            value={afnFilter}
            onChange={(e) => setAfnFilter(e.target.value as AfnFilter)}
            aria-label="Airflow network"
          >
            <option value="all">Any AFN role</option>
            <option value="operable">Operable in the AFN</option>
            <option value="leakage">Leakage only in the AFN</option>
            <option value="none">Not in the AFN (fixed)</option>
          </select>
        )}
        <input
          type="search"
          placeholder="Filter by name"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Filter by name"
        />
      </div>
      <div ref={scrollRef} className="table-scroll">
        <div className="table-header" style={{ gridTemplateColumns: template, width: totalWidth }}>
          {header('name', 'Name')}
          <div className="cell head" />
          {columns.map((c) => header(c.key, c.label, c.numeric, c.title))}
        </div>
        <div
          style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                className={`table-row static${row.id === selectedId ? ' selected' : ''}`}
                style={{
                  gridTemplateColumns: template,
                  transform: `translateY(${item.start}px)`,
                  height: ROW_HEIGHT,
                  width: totalWidth,
                }}
              >
                <span className="cell">
                  <button
                    type="button"
                    className="ref"
                    onClick={() => onSelect(row.id)}
                    title={row.name}
                  >
                    {row.name}
                  </button>
                </span>
                <span className="cell">
                  <button
                    type="button"
                    className="link count"
                    onClick={() => onShow3D(row.id)}
                    title="Show in 3D"
                  >
                    3D
                  </button>
                </span>
                {columns.map((c) => (
                  <span key={c.key} className={`cell${c.numeric ? ' num' : ''}`}>
                    {c.render(row, { select: onSelect, openCard: onOpenCard })}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
