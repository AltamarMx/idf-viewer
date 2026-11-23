import { useEffect, useMemo, useState } from 'react';
import type {
  ConstructionLayer,
  ConstructionRow,
  LayerCategory,
} from '../../core/constructions/constructions';
import type { DescribedField } from '../../core/model/describe';
import { formatArea, formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';

interface Props {
  selectedId: number | null;
  onSelect: (id: number) => void;
  onShow3D: (id: number) => void;
}

const KIND_LABELS: Record<string, string> = {
  wall: 'walls',
  floor: 'floors',
  roof: 'roofs',
  ceiling: 'ceilings',
  window: 'windows',
  glassdoor: 'glass doors',
  door: 'doors',
  tdd: 'tubular daylighting devices',
};

const CATEGORY_LABELS: Record<LayerCategory, string> = {
  opaque: 'Opaque material',
  nomass: 'No-mass material (thermal resistance only)',
  airgap: 'Air gap (thermal resistance only)',
  glazing: 'Glass',
  gas: 'Gas',
  simpleglazing: 'Simple glazing system',
  shading: 'Shade, blind or screen',
  other: 'Other material',
  missing: 'Material not found',
};

const MAX_SURFACES = 50;

/** Constructions, their layers (E1) and where they are used (E3). */
export default function ConstructionsTab({ selectedId, onSelect, onShow3D }: Props) {
  const [rows, setRows] = useState<ConstructionRow[] | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    idf.constructions().then((list) => {
      setRows(list);
      setCurrent((c) => c ?? list[0]?.id ?? null);
    });
  }, []);

  // Follow the inspector when it shows a construction.
  useEffect(() => {
    if (selectedId !== null && rows?.some((r) => r.id === selectedId)) setCurrent(selectedId);
  }, [selectedId, rows]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  if (!rows) return <div className="content count">Reading the constructions…</div>;
  if (rows.length === 0) return <div className="content">This file has no constructions.</div>;
  const row = rows.find((r) => r.id === current) ?? rows[0];

  return (
    <div className="constructions">
      <div className="constructions-layout">
        <div className="constructions-list">
          <div className="tree-filter">
            <input
              id="construction-filter"
              type="search"
              placeholder={`Filter ${formatInt(rows.length)} constructions`}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <div className="table-wrap">
            <table className="grid construction-table">
              <thead>
                <tr>
                  <th>Construction</th>
                  <th className="num">Layers</th>
                  <th className="num">Surfaces</th>
                  <th className="num">Area (m²)</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={r.id}
                    className={r.id === row?.id ? 'selected' : undefined}
                    onClick={() => setCurrent(r.id)}
                  >
                    <td>
                      <button type="button" className="row-button" onClick={() => setCurrent(r.id)}>
                        {r.name}
                      </button>
                      {r.glazed && <span className="tag">window</span>}
                      {r.layers.some((l) => l.category === 'missing') && (
                        <span className="tag warn">missing layer</span>
                      )}
                      {r.usage.surfaces === 0 && r.usedBy.length === 0 && (
                        <span className="tag">not used</span>
                      )}
                    </td>
                    <td className="num">{r.layers.length || '—'}</td>
                    <td className="num">{r.usage.surfaces ? formatInt(r.usage.surfaces) : '—'}</td>
                    <td className="num">{r.usage.area ? formatNumber(r.usage.area) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="construction-detail">
          {row && <ConstructionDetail row={row} onSelect={onSelect} onShow3D={onShow3D} />}
        </div>
      </div>
    </div>
  );
}

function ConstructionDetail({
  row,
  onSelect,
  onShow3D,
}: {
  row: ConstructionRow;
  onSelect: (id: number) => void;
  onShow3D: (id: number) => void;
}) {
  const [allSurfaces, setAllSurfaces] = useState(false);
  const { usage } = row;
  const surfaces = allSurfaces ? usage.list : usage.list.slice(0, MAX_SURFACES);

  return (
    <div className="content">
      <div className="construction-title">
        <button type="button" className="ref" onClick={() => onSelect(row.id)}>
          {row.name}
        </button>
        <span className="count"> {row.className}</span>
      </div>

      {row.layers.length > 0 ? (
        <>
          <LayerSection row={row} />
          <div className="layer-cards">
            {row.layers.map((layer, i) => (
              <LayerCard
                // biome-ignore lint/suspicious/noArrayIndexKey: the same material can be two layers
                key={i}
                index={i + 1}
                layer={layer}
                onSelect={onSelect}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="count">This construction has no layers: EnergyPlus uses the values below.</p>
      )}
      {row.fields.length > 0 && <FieldList fields={row.fields} onSelect={onSelect} />}
      {row.internalSource && (
        <div className="layer-card">
          <div className="layer-head">
            <span className="layer-number source">Heat source</span>
            <button
              type="button"
              className="ref"
              onClick={() => onSelect(row.internalSource?.id as number)}
            >
              {row.internalSource.name ?? row.internalSource.className}
            </button>
            <span className="count"> {row.internalSource.className}</span>
          </div>
          <FieldList fields={row.internalSource.fields} onSelect={onSelect} />
        </div>
      )}

      <h3>Where it is used</h3>
      {usage.surfaces === 0 && row.usedBy.length === 0 ? (
        <p className="count">No surface or other object uses this construction.</p>
      ) : (
        <>
          {usage.surfaces > 0 && (
            <p>
              {formatInt(usage.surfaces)} {usage.surfaces === 1 ? 'surface' : 'surfaces'} in{' '}
              {formatInt(usage.zones)} {usage.zones === 1 ? 'zone' : 'zones'},{' '}
              {formatArea(usage.area)}{' '}
              <span className="count">
                (
                {usage.byKind
                  .map((k) => `${formatInt(k.count)} ${KIND_LABELS[k.kind] ?? k.kind}`)
                  .join(', ')}
                ; with window multipliers, without zone multipliers)
              </span>{' '}
              <button type="button" className="btn small" onClick={() => onShow3D(row.id)}>
                Show in 3D
              </button>
            </p>
          )}
          {usage.surfaces > 0 && (
            <div className="table-wrap">
              <table className="grid construction-surfaces">
                <thead>
                  <tr>
                    <th>Surface</th>
                    <th>Type</th>
                    <th>Zone</th>
                    <th className="num">Area (m²)</th>
                  </tr>
                </thead>
                <tbody>
                  {surfaces.map((s) => (
                    <tr key={`${s.id}-${s.name}`}>
                      <td>
                        <button type="button" className="ref" onClick={() => onSelect(s.id)}>
                          {s.name}
                        </button>
                      </td>
                      <td>{s.kind}</td>
                      <td>{s.zone ?? '—'}</td>
                      <td className="num">{formatNumber(s.area)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {usage.list.length > MAX_SURFACES && (
            <button type="button" className="ref" onClick={() => setAllSurfaces((v) => !v)}>
              {allSurfaces ? 'Show fewer' : `Show all ${formatInt(usage.list.length)} surfaces`}
            </button>
          )}
          {row.usedBy.length > 0 && (
            <>
              <p className="count">Also named by:</p>
              <ul className="ref-list">
                {row.usedBy.map((u) => (
                  <li key={`${u.id}-${u.fieldName}`}>
                    <button type="button" className="ref" onClick={() => onSelect(u.id)}>
                      {u.name ?? u.className}
                    </button>
                    <span className="count">
                      {' '}
                      {u.className} · {u.fieldName}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Drawn width (px) of layers without a thickness, and the least width of thin layers. */
const FIXED_WIDTH = 40;
const MIN_WIDTH = 10;
const SECTION_WIDTH = 520;
const SECTION_HEIGHT = 120;
const MARGIN = 60;

/** Cross-section from outside (left) to inside (right), thicknesses to scale. */
function LayerSection({ row }: { row: ConstructionRow }) {
  const { layers } = row;
  const sized = layers.filter((l) => l.thickness !== undefined && l.thickness > 0);
  const fixed = layers.length - sized.length;
  const total = sized.reduce((sum, l) => sum + (l.thickness as number), 0);
  const available = Math.max(SECTION_WIDTH - fixed * FIXED_WIDTH, SECTION_WIDTH / 3);
  const scale = total > 0 ? available / total : 0;
  let enlarged = false;
  const widths = layers.map((l) => {
    if (l.thickness === undefined || l.thickness <= 0) return FIXED_WIDTH;
    const w = l.thickness * scale;
    if (w < MIN_WIDTH) enlarged = true;
    return Math.max(MIN_WIDTH, w);
  });
  const width = widths.reduce((a, b) => a + b, 0);
  const left = MARGIN + (SECTION_WIDTH - width) / 2;
  const xs = widths.map((_, i) => left + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const source = row.internalSource?.afterLayer;
  const top = 24;

  return (
    <figure className="layer-section">
      <svg
        viewBox={`0 0 ${SECTION_WIDTH + 2 * MARGIN} ${SECTION_HEIGHT + top + 34}`}
        role="img"
        aria-label={`Layers of ${row.name}, from outside to inside`}
      >
        <defs>
          <pattern
            id="layer-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
          </pattern>
        </defs>
        <text x={MARGIN - 8} y={top + SECTION_HEIGHT / 2} className="side-label" textAnchor="end">
          Outside
        </text>
        <text
          x={MARGIN + SECTION_WIDTH + 8}
          y={top + SECTION_HEIGHT / 2}
          className="side-label"
          textAnchor="start"
        >
          Inside
        </text>
        {layers.map((l, i) => {
          const x = xs[i] as number;
          const w = widths[i] as number;
          const hatched = l.category === 'nomass' || l.category === 'airgap';
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the same material can be two layers
            <g key={i}>
              <rect
                x={x}
                y={top}
                width={w}
                height={SECTION_HEIGHT}
                className={`layer-rect ${l.category}${i % 2 ? ' alt' : ''}`}
              >
                <title>
                  {`${i + 1}. ${l.name}${l.thickness !== undefined ? ` · ${formatNumber(l.thickness * 1000)} mm` : ''}`}
                </title>
              </rect>
              {hatched && (
                <rect
                  x={x}
                  y={top}
                  width={w}
                  height={SECTION_HEIGHT}
                  fill="url(#layer-hatch)"
                  pointerEvents="none"
                />
              )}
              <text x={x + w / 2} y={top - 6} className="layer-index" textAnchor="middle">
                {i + 1}
              </text>
              {w >= 34 && (
                <text
                  x={x + w / 2}
                  y={top + SECTION_HEIGHT + 16}
                  className="layer-size"
                  textAnchor="middle"
                >
                  {l.thickness !== undefined ? `${formatNumber(l.thickness * 1000)} mm` : 'R only'}
                </text>
              )}
            </g>
          );
        })}
        {source !== undefined && source >= 1 && source < layers.length && (
          <line
            x1={(xs[source] as number) - 0.5}
            x2={(xs[source] as number) - 0.5}
            y1={top - 2}
            y2={top + SECTION_HEIGHT + 2}
            className="source-line"
          >
            <title>Heat source after layer {source}</title>
          </line>
        )}
      </svg>
      <figcaption className="count">
        Outside on the left. Thicknesses to scale
        {total > 0 ? ` (total ${formatNumber(total * 1000)} mm)` : ''}
        {fixed > 0
          ? '; layers with only a thermal resistance have a fixed width and are hatched'
          : ''}
        {enlarged ? '; very thin layers are drawn wider so they can be seen' : ''}
        {source !== undefined ? `; the dashed line is the heat source after layer ${source}` : ''}.
      </figcaption>
    </figure>
  );
}

function LayerCard({
  index,
  layer,
  onSelect,
}: {
  index: number;
  layer: ConstructionLayer;
  onSelect: (id: number) => void;
}) {
  return (
    <div className={`layer-card${layer.category === 'missing' ? ' missing' : ''}`}>
      <div className="layer-head">
        <span className={`layer-number ${layer.category}`}>{index}</span>
        {layer.id !== undefined ? (
          <button type="button" className="ref" onClick={() => onSelect(layer.id as number)}>
            {layer.name}
          </button>
        ) : (
          <strong>{layer.name}</strong>
        )}
        <span className="count">
          {' '}
          {layer.className ?? ''} · {CATEGORY_LABELS[layer.category]}
        </span>
      </div>
      {layer.category === 'missing' ? (
        <p className="count">There is no material with this name in the file.</p>
      ) : (
        <FieldList fields={layer.fields} onSelect={onSelect} />
      )}
    </div>
  );
}

function FieldList({
  fields,
  onSelect,
}: {
  fields: DescribedField[];
  onSelect: (id: number) => void;
}) {
  return (
    <dl className="field-list">
      {fields.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>
            {f.refId !== undefined ? (
              <button type="button" className="ref" onClick={() => onSelect(f.refId as number)}>
                {f.value}
              </button>
            ) : (
              f.value
            )}
            {f.units && f.units !== 'dimensionless' ? ` ${f.units}` : ''}
            {f.defaulted && (
              <span className="tag" title="The field is blank: EnergyPlus uses the IDD default">
                default
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
