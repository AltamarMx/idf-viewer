import { useEffect, useMemo, useState } from 'react';
import type { ProfileValue, WindNode, WindView } from '../../core/airflow/wind';
import { formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { Chart, type ChartOption } from '../charts/Chart';

/** Categorical order for the nodes when they are compared (fixed, never cycled). */
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
};
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Site wind profile and wind pressure coefficients of the external nodes (L9). */
export function WindPanel({ onSelect, dark }: { onSelect: (id: number) => void; dark: boolean }) {
  const [view, setView] = useState<WindView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    idf.wind().then(setView);
  }, []);

  if (!view) return <div className="content count">Reading the wind settings…</div>;
  const node = view.nodes.find((n) => n.name === selected) ?? view.nodes[0];
  const drawable = view.nodes.filter((n) => n.cp.curve.length > 0);

  return (
    <div className="content wind">
      <h3>Wind pressure coefficients (Cp)</h3>
      {!view.afn ? (
        <p className="count">This file has no AirflowNetwork, so it has no external nodes.</p>
      ) : !view.cpInput ? (
        <div className="notice">
          Wind Pressure Coefficient Type is SurfaceAverageCalculation: EnergyPlus computes the Cp of
          each facade from the building type, the long axis and the width ratio. The viewer does not
          reproduce that calculation yet.
        </div>
      ) : view.nodes.length === 0 ? (
        <p className="count">Cp are Input, but there are no external nodes.</p>
      ) : (
        <div className="wind-layout">
          <div>
            <div className="table-wrap">
              <table className="grid wind-nodes">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th className="num">Height (m)</th>
                    <th className="num" title="Local wind speed / weather file wind speed">
                      Wind ×
                    </th>
                    <th>Cp from</th>
                    <th>Angle</th>
                    <th>Surfaces</th>
                  </tr>
                </thead>
                <tbody>
                  {view.nodes.map((n) => (
                    <tr
                      key={n.id}
                      className={n === node ? 'selected' : undefined}
                      onClick={() => setSelected(n.name)}
                    >
                      <td>
                        <button type="button" className="ref" onClick={() => onSelect(n.id)}>
                          {n.name}
                        </button>
                      </td>
                      <td className="num">{formatNumber(n.height)}</td>
                      <td className="num">{formatNumber(n.speedRatio)}</td>
                      <td>
                        {n.cp.id !== undefined ? (
                          <button
                            type="button"
                            className="ref"
                            onClick={() => onSelect(n.cp.id as number)}
                          >
                            {n.cp.name}
                          </button>
                        ) : (
                          n.cp.name || '—'
                        )}
                        {n.cp.className && (
                          <span className="count"> {shortClass(n.cp.className)}</span>
                        )}
                      </td>
                      <td>
                        {n.angleType}
                        {n.symmetric ? ', symmetric' : ''}
                      </td>
                      <td>
                        {surfaceSummary(n)}
                        {n.warnings.length > 0 && (
                          <span className="warn-mark" title={n.warnings.join('\n')}>
                            {' '}
                            ⚠
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="count">
              Click a row to see its Cp. Wind × is the local wind speed at the node height over the
              weather file wind speed
              {view.heightSelection?.toLowerCase() === 'openingheight'
                ? '; with OpeningHeight, EnergyPlus uses the height of each opening instead'
                : ''}
              .
            </p>
          </div>

          <div className="wind-chart">
            {drawable.length > 1 && (
              <label className="chip">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => setCompare(e.target.checked)}
                />{' '}
                Compare all nodes
              </label>
            )}
            {node && (
              <CpPolar
                nodes={compare ? drawable.slice(0, SERIES.light.length) : [node]}
                dark={dark}
                height={340}
              />
            )}
            {node && !compare && <NodeNotes node={node} />}
            {compare && drawable.length > SERIES.light.length && (
              <p className="count">The first {SERIES.light.length} nodes are compared.</p>
            )}
          </div>
        </div>
      )}

      <h3>Site wind profile</h3>
      <SiteProfile view={view} onSelect={onSelect} dark={dark} />
    </div>
  );
}

function shortClass(c: string) {
  return c.replace('AirflowNetwork:MultiZone:', '');
}

function surfaceSummary(n: WindNode): string {
  if (n.surfaces.length === 0) return 'none';
  const facings = [...new Set(n.surfaces.map((s) => s.facing))].join(', ');
  return `${n.surfaces.length} · ${facings}`;
}

function NodeNotes({ node }: { node: WindNode }) {
  const notes = [...node.cp.notes, ...node.warnings];
  return (
    <>
      <p className="chart-caption count">
        {node.angleType === 'Absolute'
          ? 'Angle: direction the wind comes from, clockwise from north (as in the weather file). '
          : 'Angle: wind direction relative to the facade (0° = wind straight onto the facade). '}
        {node.symmetric ? 'Symmetric: from 180° to 360° the curve mirrors 0°–180°. ' : ''}
        Distance from the center: Cp; outside the dashed Cp = 0 circle the wind pushes on the
        facade, inside it pulls.
        {node.cp.kind === 'values' ? ' Between directions EnergyPlus interpolates linearly.' : ''}
      </p>
      {notes.map((n) => (
        <div key={n} className="notice warn">
          {n}
        </div>
      ))}
      {node.cp.curve.length === 0 && node.cp.notes.length === 0 && (
        <p className="count">No Cp to draw.</p>
      )}
    </>
  );
}

/** Polar chart of Cp against wind angle; reused by the opening card. */
export function CpPolar({
  nodes,
  dark,
  height,
}: {
  nodes: WindNode[];
  dark: boolean;
  height: number;
}) {
  const option = useMemo<ChartOption>(() => {
    const colors = dark ? SERIES.dark : SERIES.light;
    const all = nodes.flatMap((n) => [...n.cp.curve, ...n.cp.points].map(([, cp]) => cp));
    const min = Math.min(-0.2, Math.floor(Math.min(...all, 0) * 5) / 5);
    const max = Math.max(0.2, Math.ceil(Math.max(...all, 0) * 5) / 5);
    const relative = nodes.every((n) => n.angleType === 'Relative');
    const single = nodes.length === 1 ? nodes[0] : undefined;
    const muted = dark ? '#8a8a84' : '#6b6b66';
    const series: object[] = [
      {
        name: 'Cp = 0',
        type: 'line',
        coordinateSystem: 'polar',
        data: Array.from({ length: 73 }, (_, i) => [0, i * 5]),
        showSymbol: false,
        silent: true,
        lineStyle: { type: 'dashed', width: 1, color: muted },
        tooltip: { show: false },
      },
    ];
    nodes.forEach((n, i) => {
      const color = colors[i] as string;
      series.push({
        name: n.name,
        type: 'line',
        coordinateSystem: 'polar',
        data: n.cp.curve.map(([a, cp]) => [cp, a]),
        showSymbol: false,
        lineStyle: { width: 2, color },
        itemStyle: { color },
      });
      // The values as entered, where they are points.
      if (single && n.cp.points.length > 0)
        series.push({
          name: `${n.name} (input)`,
          type: 'scatter',
          coordinateSystem: 'polar',
          data: n.cp.points.map(([a, cp]) => [cp, a]),
          symbolSize: 8,
          itemStyle: { color, borderColor: dark ? '#1a1a19' : '#ffffff', borderWidth: 2 },
        });
    });
    // Where each facade faces: wind from that direction hits it straight on.
    if (single?.angleType === 'Absolute') {
      for (const az of [
        ...new Set(
          single.surfaces
            .filter((s) => s.facing !== 'Roof' && s.facing !== 'Floor')
            .map((s) => Math.round(s.azimuth)),
        ),
      ])
        series.push({
          name: `Facade faces ${az}°`,
          type: 'line',
          coordinateSystem: 'polar',
          data: [
            [min, az],
            [max, az],
          ],
          showSymbol: false,
          silent: true,
          lineStyle: { width: 1, type: 'dotted', color: muted },
          tooltip: { show: false },
        });
    }
    return {
      color: colors,
      legend:
        nodes.length > 1 ? { top: 0, type: 'scroll', data: nodes.map((n) => n.name) } : undefined,
      tooltip: {
        trigger: 'item',
        formatter: (p: { seriesName: string; value: [number, number] }) =>
          `${p.seriesName}<br/>${p.value[1]}°: Cp <b>${formatNumber(p.value[0])}</b>`,
      },
      polar: { center: ['50%', nodes.length > 1 ? '55%' : '50%'], radius: '72%' },
      angleAxis: {
        type: 'value',
        min: 0,
        max: 360,
        interval: 45,
        startAngle: 90,
        clockwise: true,
        axisLabel: {
          formatter: (v: number) => (relative ? `${v}°` : `${COMPASS[v / 45] ?? ''} ${v}°`),
        },
        splitLine: { lineStyle: { opacity: 0.35 } },
      },
      radiusAxis: {
        type: 'value',
        min,
        max,
        interval: 0.2,
        // The center label would sit on the curves.
        axisLabel: { formatter: (v: number) => (v === min ? '' : formatNumber(v)), fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.35 } },
      },
      series,
    };
  }, [nodes, dark]);
  return <Chart option={option} height={height} dark={dark} />;
}

function SiteProfile({
  view,
  onSelect,
  dark,
}: {
  view: WindView;
  onSelect: (id: number) => void;
  dark: boolean;
}) {
  const { site } = view;
  const option = useMemo<ChartOption>(() => {
    const color = dark ? '#3987e5' : '#2a78d6';
    const nodes = [...new Map(view.nodes.map((n) => [n.height, n])).values()];
    return {
      grid: { left: 52, right: 24, top: 16, bottom: 44 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (ps: { value: [number, number] }[]) => {
          const p = ps[0];
          return p
            ? `${formatNumber(p.value[1])} m: wind × <b>${formatNumber(p.value[0])}</b>`
            : '';
        },
      },
      xAxis: {
        type: 'value',
        name: 'local wind / weather file wind',
        nameLocation: 'middle',
        nameGap: 26,
        min: 0,
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      yAxis: {
        type: 'value',
        name: 'height (m)',
        min: 0,
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      series: [
        {
          type: 'line',
          data: site.profile.map(([z, r]) => [r, z]),
          showSymbol: false,
          lineStyle: { width: 2, color },
          itemStyle: { color },
        },
        {
          type: 'scatter',
          data: nodes.map((n) => [n.speedRatio, n.height]),
          symbolSize: 8,
          itemStyle: { color, borderColor: dark ? '#1a1a19' : '#ffffff', borderWidth: 2 },
          tooltip: { show: false },
        },
      ],
    };
  }, [site, view.nodes, dark]);

  const row = (label: string, v: ProfileValue, units = '') => (
    <tr>
      <td>{label}</td>
      <td className="num">
        {formatNumber(v.value)}
        {units}
      </td>
      <td>
        {v.id !== undefined ? (
          <button type="button" className="ref" onClick={() => onSelect(v.id as number)}>
            {v.from}
          </button>
        ) : (
          <span className="count">{v.from}</span>
        )}
      </td>
    </tr>
  );

  return (
    <div className="wind-layout">
      <div>
        <table className="grid afn-fields">
          <thead>
            <tr>
              <th />
              <th className="num">Value</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {row('Site: profile exponent α', site.exponent)}
            {row('Site: boundary layer thickness δ', site.boundaryLayer, ' m')}
            {row('Weather station: wind sensor height', site.station.height, ' m')}
            {row('Weather station: profile exponent', site.station.exponent)}
            {row('Weather station: boundary layer thickness', site.station.boundaryLayer, ' m')}
          </tbody>
        </table>
        <p className="count">
          EnergyPlus moves the weather file wind to each height z with{' '}
          <span className="formula">
            V(z) = V<sub>met</sub> · (δ<sub>met</sub>/z<sub>met</sub>)<sup>α met</sup> · (z/δ)
            <sup>α</sup>
          </span>
          . With these values the first factor is {formatNumber(site.stationFactor)}.
          {view.nodes.length > 0 ? ' The dots are the external nodes.' : ''}
        </p>
      </div>
      <div className="wind-chart">
        <Chart option={option} height={260} dark={dark} />
      </div>
    </div>
  );
}
