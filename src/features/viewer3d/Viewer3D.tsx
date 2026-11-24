import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeometryView, ObjectRef, SurfaceView } from '../../core/session';
import { formatArea, formatInt, formatNumber } from '../../ui/format';
import {
  AFN_MODES,
  type Category,
  COLOR_MODES,
  type ColorMode,
  categorize,
  isGlazed,
} from './colors';
import {
  type ExplodeMode,
  explodeOffsets,
  offsetOf,
  type PairStatus,
  pairLines,
  surfaceCenters,
  type Vec3,
  zoneCenters,
} from './explode';
import { SceneView, type ViewName } from './scene';

interface Props {
  geometry: GeometryView;
  selection: ObjectRef | null;
  onSelect: (id: number) => void;
  onClear: () => void;
  dark: boolean;
}

const VIEWS: { id: ViewName; label: string }[] = [
  { id: 'iso', label: 'Iso' },
  { id: 'top', label: 'Top' },
  { id: 'north', label: 'N' },
  { id: 'east', label: 'E' },
  { id: 'south', label: 'S' },
  { id: 'west', label: 'W' },
];

const HIGHLIGHT = '#ffb300';
const PARTNER = '#d500f9';

/** Surfaces highlighted for the selected object (C5): itself, or what uses that zone, space or construction. */
function highlighted(surfaces: SurfaceView[], selection: ObjectRef | null): Set<number> {
  const result = new Set<number>();
  if (!selection) return result;
  surfaces.forEach((s, i) => {
    if (s.id === selection.id) result.add(i);
  });
  if (result.size > 0 || !selection.name) return result;
  const cls = selection.className.toLowerCase();
  const name = selection.name.toLowerCase();
  const field: keyof SurfaceView | null =
    cls === 'zone'
      ? 'zone'
      : cls === 'space'
        ? 'space'
        : cls.startsWith('construction')
          ? 'construction'
          : null;
  if (!field) return result;
  surfaces.forEach((s, i) => {
    if (String(s[field] ?? '').toLowerCase() === name) result.add(i);
  });
  return result;
}

/** Surface types shown or hidden together in the layers panel. */
const KIND_GROUPS = [
  { id: 'wall', label: 'Walls' },
  { id: 'floor', label: 'Floors' },
  { id: 'roof', label: 'Roofs' },
  { id: 'ceiling', label: 'Ceilings' },
  { id: 'window', label: 'Windows' },
  { id: 'door', label: 'Doors' },
  { id: 'shading', label: 'Shading' },
];

function kindGroup(kind: string): string {
  if (kind === 'glassdoor' || kind === 'tdd') return 'window';
  return kind;
}

const PAIR_COLORS: Record<PairStatus, string> = {
  ok: '#2e9e44',
  'one-way': '#f08c00',
  missing: '#e03131',
};

/** A copy of the set with `value` added or removed. */
function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

type PartnerState =
  | { status: 'none' }
  | { status: 'ok' | 'one-way'; index: number; name: string; pointsTo?: string }
  | { status: 'missing'; name: string };

/** C12: the other side of an interzone surface, and whether it points back. */
function partnerOf(surfaces: SurfaceView[], selected: number[]): PartnerState {
  if (selected.length !== 1) return { status: 'none' };
  const s = surfaces[selected[0] as number] as SurfaceView;
  if (s.boundary !== 'Surface' || !s.boundaryObject) return { status: 'none' };
  const target = s.boundaryObject.toLowerCase();
  if (target === s.name.toLowerCase()) return { status: 'none' };
  const index = surfaces.findIndex((o) => o.name.toLowerCase() === target && o.kind !== 'shading');
  if (index < 0) return { status: 'missing', name: s.boundaryObject };
  const other = surfaces[index] as SurfaceView;
  const back = other.boundaryObject?.toLowerCase() === s.name.toLowerCase();
  return {
    status: back ? 'ok' : 'one-way',
    index,
    name: other.name,
    pointsTo: other.boundaryObject,
  };
}

export default function Viewer3D({ geometry, selection, onSelect, onClear, dark }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<SceneView | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [mode, setMode] = useState<ColorMode>('boundary');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const surfaces = geometry.surfaces;

  const { of, legend } = useMemo(() => categorize(surfaces, mode), [surfaces, mode]);
  const stats = useMemo(() => {
    const map = new Map<string, { count: number; area: number }>();
    surfaces.forEach((s, i) => {
      const key = (of[i] as Category).key;
      const entry = map.get(key) ?? { count: 0, area: 0 };
      entry.count++;
      entry.area += s.area * s.multiplier;
      map.set(key, entry);
    });
    return map;
  }, [surfaces, of]);

  const hasAfn = geometry.afn.present || surfaces.some((s) => s.afn);
  const hasSpaces = surfaces.some((s) => s.space);
  const modes = COLOR_MODES.filter((m) => (!m.afn || hasAfn) && (!m.spaces || hasSpaces));

  // Layers and cuts (C7) and daylighting points (C9).
  const [layers, setLayers] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [showPoints, setShowPoints] = useState(true);
  const [showPairs, setShowPairs] = useState(false);
  const [hiddenZones, setHiddenZones] = useState<Set<string>>(new Set());
  const [hiddenLevels, setHiddenLevels] = useState<Set<number>>(new Set());
  const [opacity, setOpacity] = useState(1);
  const [cut, setCut] = useState<number | null>(null);
  const [explodeMode, setExplodeMode] = useState<ExplodeMode>('zones');
  const [explode, setExplode] = useState(0);

  const centers = useMemo(() => surfaceCenters(surfaces), [surfaces]);
  const zoneCenter = useMemo(() => zoneCenters(surfaces, centers), [surfaces, centers]);
  const pairs = useMemo(() => pairLines(surfaces), [surfaces]);
  const pairCounts = useMemo(() => {
    const counts: Record<PairStatus, number> = { ok: 0, 'one-way': 0, missing: 0 };
    for (const p of pairs) counts[p.status]++;
    return counts;
  }, [pairs]);
  const kinds = useMemo(() => {
    const present = new Set(surfaces.map((s) => kindGroup(s.kind)));
    return KIND_GROUPS.filter((k) => present.has(k.id));
  }, [surfaces]);

  const zoneNames = useMemo(
    () =>
      [...new Set(surfaces.map((s) => s.zone).filter((z): z is string => Boolean(z)))].sort(
        (a, b) => a.localeCompare(b, undefined, { numeric: true }),
      ),
    [surfaces],
  );
  const levels = useMemo(
    () =>
      [...new Set(surfaces.map((s) => s.level).filter((l): l is number => l !== undefined))].sort(
        (a, b) => a - b,
      ),
    [surfaces],
  );
  const zLow = geometry.center[2] - geometry.size[2] / 2;
  const zHigh = geometry.center[2] + geometry.size[2] / 2;
  const pointLevel = useMemo(() => {
    const byZone = new Map(surfaces.map((s) => [s.zone?.toLowerCase(), s.level]));
    return geometry.daylightingPoints.map((p) => byZone.get(p.zone?.toLowerCase()));
  }, [surfaces, geometry.daylightingPoints]);
  const layerVisible = useMemo(
    () =>
      surfaces.map((s) => {
        if (hiddenKinds.has(kindGroup(s.kind))) return false;
        if (s.zone && hiddenZones.has(s.zone.toLowerCase())) return false;
        if (s.level !== undefined && hiddenLevels.has(s.level)) return false;
        return true;
      }),
    [surfaces, hiddenKinds, hiddenZones, hiddenLevels],
  );
  const layersOn =
    hiddenKinds.size > 0 ||
    showPairs ||
    hiddenZones.size > 0 ||
    hiddenLevels.size > 0 ||
    opacity < 1 ||
    cut !== null ||
    explode > 0;
  const selected = useMemo(() => [...highlighted(surfaces, selection)], [surfaces, selection]);
  const partner = useMemo(() => partnerOf(surfaces, selected), [surfaces, selected]);

  // Create the scene for this geometry.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let view: SceneView;
    try {
      view = new SceneView(container, geometry);
    } catch (e) {
      setError(`3D is not available in this browser (WebGL2 is required). ${String(e)}`);
      return;
    }
    view.onRender = (angle) => {
      if (compassRef.current) compassRef.current.style.transform = `rotate(${angle}rad)`;
    };
    viewRef.current = view;
    let down: { x: number; y: number } | null = null;
    const canvas = view.renderer.domElement;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const index = view.pick(e.clientX, e.clientY);
      if (index !== null) onSelectRef.current((geometry.surfaces[index] as SurfaceView).id);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      view.dispose();
      viewRef.current = null;
    };
  }, [geometry]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply after the scene is rebuilt for new geometry
  useEffect(() => viewRef.current?.setTheme(dark), [dark, geometry]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply after the scene is rebuilt for new geometry
  useEffect(() => {
    const colors = of.map((c) => c.color);
    const lighter = surfaces.map((s) => isGlazed(s) && mode !== 'type' && !AFN_MODES.has(mode));
    for (const i of selected) {
      colors[i] = HIGHLIGHT;
      lighter[i] = false;
    }
    if (partner.status === 'ok' || partner.status === 'one-way') {
      colors[partner.index] = PARTNER;
      lighter[partner.index] = false;
    }
    viewRef.current?.setColors(colors, lighter);
  }, [of, selected, partner, geometry, surfaces, mode]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply after the scene is rebuilt for new geometry
  useEffect(() => {
    viewRef.current?.setVisible(of.map((c, i) => !hidden.has(c.key) && Boolean(layerVisible[i])));
  }, [of, hidden, layerVisible, geometry]);

  useEffect(() => {
    viewRef.current?.setPointsVisible(
      geometry.daylightingPoints.map((p, i) => {
        if (!showPoints) return false;
        if (p.zone && hiddenZones.has(p.zone.toLowerCase())) return false;
        const level = pointLevel[i];
        return level === undefined || !hiddenLevels.has(level);
      }),
    );
  }, [showPoints, hiddenZones, hiddenLevels, pointLevel, geometry]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply after the scene is rebuilt for new geometry
  useEffect(() => viewRef.current?.setOpacity(opacity), [opacity, geometry]);

  // The cut is a world height; the scene is centered on the model.
  useEffect(
    () => viewRef.current?.setCut(cut === null ? null : cut - geometry.center[2]),
    [cut, geometry],
  );

  // Exploded view: floors up, or zones away from the center of the model.
  const offsets = useMemo(
    () => explodeOffsets(surfaces, explodeMode, explode, zoneCenter, levels),
    [surfaces, explodeMode, explode, zoneCenter, levels],
  );
  useEffect(() => {
    viewRef.current?.setOffsets(
      offsets,
      geometry.daylightingPoints.map((p, i) =>
        offsetOf(p.zone, pointLevel[i], explodeMode, explode, zoneCenter, levels),
      ),
    );
  }, [offsets, explodeMode, explode, zoneCenter, levels, pointLevel, geometry]);

  // Lines between interzone pairs, from center to center, moved with their surfaces.
  useEffect(() => {
    const at = (i: number): Vec3 => {
      const c = centers[i] as Vec3;
      const o = offsets[i] as Vec3;
      return [c[0] + o[0], c[1] + o[1], c[2] + o[2]];
    };
    const stub = Math.max(0.5, Math.max(...geometry.size) * 0.04);
    viewRef.current?.setPairLines(
      showPairs
        ? pairs
            .filter((p) => layerVisible[p.from] || (p.to !== undefined && layerVisible[p.to]))
            .map((p) => {
              const from = at(p.from);
              // A missing other side: a short line out of the surface.
              const n = (surfaces[p.from] as SurfaceView).normal;
              const to =
                p.to !== undefined
                  ? at(p.to)
                  : ([from[0] + n[0] * stub, from[1] + n[1] * stub, from[2] + n[2] * stub] as Vec3);
              return { from, to, color: PAIR_COLORS[p.status] };
            })
        : [],
    );
  }, [showPairs, pairs, centers, offsets, layerVisible, surfaces, geometry]);

  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isolate = (key: string) =>
    setHidden(new Set(legend.map((c) => c.key).filter((k) => k !== key)));

  if (surfaces.length === 0) {
    return <div className="content">This file has no surfaces to draw.</div>;
  }

  const one = selected.length === 1 ? (surfaces[selected[0] as number] as SurfaceView) : null;

  return (
    <div className="viewer">
      <div ref={containerRef} className="viewer-canvas" />
      {error && <div className="notice error viewer-error">{error}</div>}

      <div className="viewer-toolbar">
        <label>
          Color by{' '}
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as ColorMode);
              setHidden(new Set());
            }}
          >
            {modes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="btn-group">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className="btn small"
              onClick={() => viewRef.current?.setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`btn small${layersOn ? ' primary' : ''}`}
          aria-expanded={layers}
          onClick={() => setLayers((v) => !v)}
        >
          Layers and cuts
        </button>
      </div>

      {layers && (
        <div className="layers-panel">
          <div className="layers-row">
            {kinds.map((k) => (
              <label key={k.id}>
                <input
                  type="checkbox"
                  checked={!hiddenKinds.has(k.id)}
                  onChange={() => setHiddenKinds((current) => toggled(current, k.id))}
                />{' '}
                {k.label}
              </label>
            ))}
            {geometry.daylightingPoints.length > 0 && (
              <label>
                <input
                  type="checkbox"
                  checked={showPoints}
                  onChange={(e) => setShowPoints(e.target.checked)}
                />{' '}
                Daylighting points ({formatInt(geometry.daylightingPoints.length)})
              </label>
            )}
          </div>
          <label className="layers-slider">
            Opacity
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
            <span className="count">{Math.round(opacity * 100)} %</span>
          </label>
          <label className="layers-slider">
            <input
              type="checkbox"
              checked={cut !== null}
              onChange={(e) => setCut(e.target.checked ? (zLow + zHigh) / 2 : null)}
            />{' '}
            Cut at
            <input
              type="range"
              min={zLow}
              max={zHigh}
              step={Math.max((zHigh - zLow) / 200, 0.01)}
              value={cut ?? (zLow + zHigh) / 2}
              disabled={cut === null}
              onChange={(e) => setCut(Number(e.target.value))}
            />
            <span className="count">{cut === null ? '—' : `${formatNumber(cut)} m`}</span>
          </label>
          <div className="layers-explode">
            <label htmlFor="explode-mode">Separate</label>
            <select
              id="explode-mode"
              value={explodeMode}
              onChange={(e) => {
                setExplodeMode(e.target.value as ExplodeMode);
                setExplode(0);
              }}
            >
              <option value="zones">zones</option>
              {levels.length > 1 && <option value="floors">floors</option>}
            </select>
            <input
              type="range"
              aria-label="Separation"
              min={0}
              max={
                explodeMode === 'zones'
                  ? 1.5
                  : Math.max(5, Math.ceil(geometry.size[2] / Math.max(levels.length, 1)) * 2)
              }
              step={explodeMode === 'zones' ? 0.05 : 0.5}
              value={explode}
              onChange={(e) => setExplode(Number(e.target.value))}
            />
            <span className="count">
              {!explode
                ? 'off'
                : explodeMode === 'zones'
                  ? `${Math.round(explode * 100)} %`
                  : `+${formatNumber(explode)} m`}
            </span>
          </div>
          {pairs.length > 0 && (
            <div className="layers-pairs">
              <label>
                <input
                  type="checkbox"
                  checked={showPairs}
                  onChange={(e) => setShowPairs(e.target.checked)}
                />{' '}
                Interzone pairs ({formatInt(pairs.length)})
              </label>
              {showPairs && (
                <ul>
                  <li>
                    <span className="network-line" style={{ borderColor: PAIR_COLORS.ok }} /> Both
                    sides name each other: {formatInt(pairCounts.ok)}
                  </li>
                  <li>
                    <span
                      className="network-line"
                      style={{ borderColor: PAIR_COLORS['one-way'] }}
                    />{' '}
                    The other side names another surface: {formatInt(pairCounts['one-way'])}
                  </li>
                  <li>
                    <span className="network-line" style={{ borderColor: PAIR_COLORS.missing }} />{' '}
                    The other side does not exist: {formatInt(pairCounts.missing)}
                  </li>
                </ul>
              )}
            </div>
          )}
          {levels.length > 1 && (
            <fieldset className="layers-list">
              <legend>Floor levels</legend>
              {levels.map((l) => (
                <label key={l}>
                  <input
                    type="checkbox"
                    checked={!hiddenLevels.has(l)}
                    onChange={() => setHiddenLevels((current) => toggled(current, l))}
                  />{' '}
                  {formatNumber(l)} m
                </label>
              ))}
            </fieldset>
          )}
          {zoneNames.length > 0 && (
            <fieldset className="layers-list zones">
              <legend>
                Zones{' '}
                <button type="button" className="link" onClick={() => setHiddenZones(new Set())}>
                  all
                </button>{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => setHiddenZones(new Set(zoneNames.map((z) => z.toLowerCase())))}
                >
                  none
                </button>
              </legend>
              {zoneNames.map((z) => (
                <label key={z}>
                  <input
                    type="checkbox"
                    checked={!hiddenZones.has(z.toLowerCase())}
                    onChange={() => setHiddenZones((current) => toggled(current, z.toLowerCase()))}
                  />{' '}
                  {z}
                </label>
              ))}
            </fieldset>
          )}
          {layersOn && (
            <button
              type="button"
              className="link"
              onClick={() => {
                setHiddenKinds(new Set());
                setShowPairs(false);
                setHiddenZones(new Set());
                setHiddenLevels(new Set());
                setOpacity(1);
                setCut(null);
                setExplode(0);
              }}
            >
              Reset layers
            </button>
          )}
        </div>
      )}

      <svg
        ref={compassRef}
        className="compass"
        viewBox="-20 -20 40 40"
        role="img"
        aria-label="North"
      >
        <title>North</title>
        <circle r="18" />
        <path d="M0 -15 L6 4 L0 0 L-6 4 Z" />
        <text y="-4" textAnchor="middle" transform="translate(0 16)">
          N
        </text>
      </svg>

      <div className="legend">
        <div className="legend-head">
          <strong>{COLOR_MODES.find((m) => m.id === mode)?.label}</strong>
          {hidden.size > 0 && (
            <button type="button" className="link" onClick={() => setHidden(new Set())}>
              Show all
            </button>
          )}
        </div>
        <ul>
          {legend.map((c) => {
            const s = stats.get(c.key);
            return (
              <li key={c.key} className={hidden.has(c.key) ? 'off' : ''}>
                <button
                  type="button"
                  className="legend-item"
                  onClick={() => toggle(c.key)}
                  title="Show or hide"
                >
                  <span className="swatch" style={{ background: c.color }} />
                  <span className="label">{c.label}</span>
                  <span className="count">
                    {formatInt(s?.count ?? 0)} · {formatArea(s?.area ?? 0)}
                  </span>
                </button>
                <button
                  type="button"
                  className="link only"
                  onClick={() => isolate(c.key)}
                  title="Show only this"
                >
                  only
                </button>
              </li>
            );
          })}
        </ul>
        {selected.length > 0 && (
          <div className="legend-selected">
            <span className="swatch" style={{ background: HIGHLIGHT }} />
            <span className="label">
              Selected: {selection?.name ?? selection?.className}
              {selected.length > 1 ? ` (${formatInt(selected.length)} surfaces)` : ''}
            </span>
            <button type="button" className="link" onClick={onClear}>
              Clear
            </button>
          </div>
        )}
        {partner.status === 'ok' || partner.status === 'one-way' ? (
          <div className="legend-selected">
            <span className="swatch" style={{ background: PARTNER }} />
            <span className="label">Other side of the selected surface</span>
          </div>
        ) : null}
        {mode !== 'type' && !AFN_MODES.has(mode) && (
          <div className="count legend-note">Windows are drawn lighter and see-through.</div>
        )}
        {AFN_MODES.has(mode) && !geometry.afn.active && (
          <div className="count legend-note">
            {geometry.afn.present
              ? 'AirflowNetwork:SimulationControl is set to NoMultizoneOrDistribution: EnergyPlus does not run the network.'
              : 'There is no AirflowNetwork:SimulationControl: EnergyPlus does not run the network.'}
          </div>
        )}
        {mode === 'openingFactor' && (
          <div className="count legend-note">
            Opening factor written on each AirflowNetwork surface: the most the opening can open.
          </div>
        )}
        {mode === 'cd' && (
          <div className="count legend-note">
            Discharge coefficient at the maximum opening factor (interpolated between the opening
            factor sets of a detailed opening).
          </div>
        )}
      </div>

      {one && (
        <div className="surface-info">
          <div>
            <strong>{one.name}</strong> <span className="count">{one.className}</span>
          </div>
          <div className="count">
            {one.boundary ? `${one.boundary} · ` : ''}
            {formatArea(one.area)} · azimuth {one.azimuth.toFixed(0)}° · tilt {one.tilt.toFixed(0)}°
          </div>
          {one.afn && (
            <div className="count">
              AFN: {one.afn.component} ({one.afn.type}) · factor {one.afn.factor}
              {one.afn.cd !== undefined ? ` · Cd ${formatNumber(one.afn.cd)}` : ''}
              {one.afn.role === 'operable' ? ` · control ${one.afn.controlMode}` : ''}
              {one.afn.viaPartner ? ` · listed on ${one.afn.viaPartner}` : ''}
            </div>
          )}
          {partner.status === 'ok' && (
            <div className="partner ok">Other side: {partner.name} (points back)</div>
          )}
          {partner.status === 'one-way' && (
            <div className="partner warn">
              Other side {partner.name} points to "{partner.pointsTo || '(blank)'}", not back to
              this surface
            </div>
          )}
          {partner.status === 'missing' && (
            <div className="partner warn">Other side "{partner.name}" does not exist</div>
          )}
        </div>
      )}
      {!one && selected.length > 1 && (
        <div className="surface-info">
          {formatInt(selected.length)} surfaces of {selection?.className}{' '}
          <strong>{selection?.name}</strong>
        </div>
      )}
    </div>
  );
}
