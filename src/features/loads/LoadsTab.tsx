import { useEffect, useMemo, useState } from 'react';
import { LOAD_LABELS, type LoadType } from '../../core/loads/loads';
import type { OccupancyReport, ZoneRow } from '../../core/loads/report';
import type { CalendarView, ZoneLoadView } from '../../core/session';
import { formatArea, formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { Chart, type ChartOption } from '../charts/Chart';
import { heatmapOption } from '../charts/options';
import { dayLabel, hourLabel } from '../charts/time';

interface Props {
  dark: boolean;
  onSelect: (id: number) => void;
}

const TYPE_COLORS: Record<LoadType, string> = {
  people: '#e07a5f',
  lights: '#f2c14e',
  electric: '#3d85c6',
  gas: '#e69138',
  hotwater: '#cc4125',
  steam: '#8e7cc3',
  other: '#6aa84f',
};

const TYPES: LoadType[] = ['people', 'lights', 'electric', 'gas', 'hotwater', 'steam', 'other'];

/** Zones and densities (D3, D4), internal loads over time (F9) and occupancy check (F10). */
export default function LoadsTab({ dark, onSelect }: Props) {
  const [rows, setRows] = useState<ZoneRow[] | null>(null);
  const [calendar, setCalendar] = useState<CalendarView | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [perArea, setPerArea] = useState(false);
  const [discountLost, setDiscountLost] = useState(false);
  const [view, setView] = useState<ZoneLoadView | null>(null);
  const [occupancy, setOccupancy] = useState<OccupancyReport | null>(null);

  useEffect(() => {
    idf.zoneTable().then(setRows);
    idf.calendar().then(setCalendar);
    idf.occupancy().then(setOccupancy);
  }, []);

  useEffect(() => {
    setView(null);
    idf.zoneLoads(zone, discountLost).then(setView);
  }, [zone, discountLost]);

  const charts = useMemo(
    () => (view && calendar ? loadOptions(view, calendar, perArea) : null),
    [view, calendar, perArea],
  );
  const occupancyHeatmap = useMemo(
    () =>
      view && calendar
        ? heatmapOption(
            view.people,
            calendar,
            zone ? `Occupants of ${zone}` : 'Occupants of the building',
            'people',
          )
        : null,
    [view, calendar, zone],
  );

  if (!rows || !calendar) return <div className="content count">Computing loads…</div>;

  const totals = rows.reduce(
    (t, r) => ({
      area: t.area + (r.partOfTotalArea ? r.floorArea * r.multiplier : 0),
      people: t.people + r.people * r.multiplier,
    }),
    { area: 0, people: 0 },
  );
  const zoneOcc = zone ? occupancy?.zones.find((z) => z.name === zone) : null;

  return (
    <div className="content wide">
      <h2>Zones</h2>
      <div className="table-wrap">
        <table className="grid zones">
          <thead>
            <tr>
              <th>Zone</th>
              <th className="num">Mult.</th>
              <th className="num">Floor area</th>
              <th className="num">Volume</th>
              <th className="num">Height</th>
              <th className="num">Surfaces</th>
              <th>HVAC</th>
              <th className="num">People</th>
              <th className="num">m²/person</th>
              <th className="num">Lights W/m²</th>
              <th className="num">Equipment W/m²</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={r.name === zone ? 'selected' : undefined}>
                <td>
                  <button
                    type="button"
                    className="ref"
                    onClick={() => setZone(r.name)}
                    title="Show loads over time"
                  >
                    {r.name}
                  </button>{' '}
                  <button
                    type="button"
                    className="link count"
                    onClick={() => onSelect(r.id)}
                    title="Inspect"
                  >
                    ⓘ
                  </button>
                  {r.spaces.length > 0 && <div className="count">{r.spaces.length} spaces</div>}
                </td>
                <td className="num">{r.multiplier}</td>
                <td
                  className="num"
                  title={
                    r.floorAreaSource === 'input' ? 'From the Zone object' : 'From floor surfaces'
                  }
                >
                  {formatNumber(r.floorArea)}
                  {r.floorAreaSource === 'input' ? '*' : ''}
                </td>
                <td className="num" title={`Volume: ${r.volumeSource}`}>
                  {formatNumber(r.volume)}
                  {r.volumeSource !== 'enclosed' ? '*' : ''}
                </td>
                <td className="num">{formatNumber(r.ceilingHeight)}</td>
                <td className="num">{r.surfaces}</td>
                <td>{r.conditioned ? 'yes' : '—'}</td>
                <td className="num">{formatNumber(r.people)}</td>
                <td className="num">{r.people > 0 ? formatNumber(r.floorArea / r.people) : '—'}</td>
                <td className="num">
                  {formatNumber(r.lights)}
                  {r.daylighting ? ' ☀' : ''}
                </td>
                <td className="num">{formatNumber(r.equipment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="count">
        Floor area in m², volume in m³, height in m. * value entered in the Zone object (or volume
        not computed from closed surfaces). ☀ zone with daylighting controls. Total:{' '}
        {formatArea(totals.area)} · {formatNumber(totals.people)} people at design level, with
        multipliers.
      </p>

      <h2 className="section">
        Internal loads over time ·{' '}
        <select
          value={zone ?? ''}
          onChange={(e) => setZone(e.target.value || null)}
          aria-label="Zone"
        >
          <option value="">Whole building (with multipliers)</option>
          {rows.map((r) => (
            <option key={r.name}>{r.name}</option>
          ))}
        </select>
      </h2>
      <div className="problems-toolbar">
        <label className="chip">
          <input type="checkbox" checked={perArea} onChange={(e) => setPerArea(e.target.checked)} />{' '}
          W/m²
        </label>
        <label className="chip">
          <input
            type="checkbox"
            checked={discountLost}
            onChange={(e) => setDiscountLost(e.target.checked)}
          />{' '}
          Only heat that reaches the zone (subtract Fraction Lost)
        </label>
      </div>
      {view?.daylighting && (
        <div className="notice">
          Lights here have daylighting controls: EnergyPlus dims them during the simulation; the
          chart shows the full lighting power × schedule.
        </div>
      )}
      {view && view.emsSchedules.length > 0 && (
        <div className="notice warn">
          EMS changes {view.emsSchedules.join(', ')} during the simulation; the chart uses the
          values written in the IDF.
        </div>
      )}
      {charts ? (
        <>
          <Chart option={charts.power} height={300} dark={dark} group="loads" />
          <Chart option={charts.people} height={170} dark={dark} group="loads" />
        </>
      ) : (
        <p className="count">Loading…</p>
      )}
      <p className="count">
        People power = occupants × activity level. Equipment shows its design level × schedule
        {discountLost ? ' minus the fraction lost' : ' (consumption)'}. Infiltration, solar gains
        and the envelope depend on the simulation and are not included. Times are standard time,
        hour ending.
      </p>

      <h2 className="section">Occupancy check</h2>
      {occupancy ? (
        <>
          <div className="facts">
            <div className="fact">
              <div className="label">{zone ? `Peak in ${zone}` : 'Peak in the building'}</div>
              <div className="value">
                {formatNumber(zone ? (zoneOcc?.peak.value ?? 0) : occupancy.buildingPeak.value)}{' '}
                people
              </div>
              <div className="detail">
                {hourLabel(
                  zone ? (zoneOcc?.peak.hour ?? 0) : occupancy.buildingPeak.hour,
                  calendar.dates,
                )}
              </div>
            </div>
            <div className="fact">
              <div className="label">Design occupants</div>
              <div className="value">
                {formatNumber(zone ? (zoneOcc?.design ?? 0) : occupancy.buildingDesign)}
              </div>
              <div className="detail">{zone ? 'this zone' : 'all zones × multipliers'}</div>
            </div>
          </div>
          {occupancyHeatmap && <Chart option={occupancyHeatmap} height={280} dark={dark} />}

          {occupancy.alerts.length > 0 && (
            <>
              <h3>Alerts</h3>
              <ul className="alerts">
                {occupancy.alerts.map((a) => (
                  <li key={a.message} className={a.severity}>
                    {a.objectId !== undefined ? (
                      <button
                        type="button"
                        className="ref"
                        onClick={() => onSelect(a.objectId as number)}
                      >
                        {a.message}
                      </button>
                    ) : (
                      a.message
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>People by zone</h3>
          <table className="grid">
            <thead>
              <tr>
                <th>Zone</th>
                <th className="num">Design</th>
                <th className="num">Peak</th>
                <th>Peak time</th>
                <th>People objects</th>
              </tr>
            </thead>
            <tbody>
              {occupancy.zones.map((z) => (
                <tr key={z.name}>
                  <td>
                    <button type="button" className="ref" onClick={() => setZone(z.name)}>
                      {z.name}
                    </button>
                    {z.multiplier !== 1 && <span className="count"> ×{z.multiplier}</span>}
                  </td>
                  <td className="num">{formatNumber(z.design)}</td>
                  <td className="num">{formatNumber(z.peak.value)}</td>
                  <td className="count">
                    {z.peak.value > 0 ? hourLabel(z.peak.hour, calendar.dates) : '—'}
                  </td>
                  <td>
                    {z.objects.length === 0
                      ? '—'
                      : z.objects.map((o, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: one object can appear once per zone list
                          <span key={`${o.id}:${i}`}>
                            {i > 0 && ', '}
                            <button type="button" className="ref" onClick={() => onSelect(o.id)}>
                              {o.name}
                            </button>
                            <span className="count">
                              {' '}
                              ({formatNumber(o.design)}
                              {o.via ? ` via ${o.via}` : ''})
                            </span>
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="count">{formatInt(occupancy.zones.length)} zones.</p>
        </>
      ) : (
        <p className="count">Loading…</p>
      )}
    </div>
  );
}

function loadOptions(
  view: ZoneLoadView,
  calendar: CalendarView,
  perArea: boolean,
): { power: ChartOption; people: ChartOption } {
  const area = perArea && view.floorArea > 0 ? view.floorArea : 1;
  const unit = perArea ? 'W/m²' : 'W';
  const present = TYPES.filter((t) => view.watts[t].some((v) => v !== 0));
  const hours = view.people.length;
  const total = new Float32Array(hours);
  for (const t of present)
    for (let h = 0; h < hours; h++) total[h] = (total[h] as number) + (view.watts[t][h] as number);
  const series = (values: Float32Array) =>
    Array.from(values, (v, h) => [h, Number((v / area).toFixed(3))]);
  const xAxis = {
    type: 'value',
    min: 0,
    max: hours,
    axisLabel: { formatter: (h: number) => dayLabel(Math.floor(h / 24), calendar.dates) },
  };
  const tooltip = {
    trigger: 'axis',
    formatter: (params: { seriesName: string; value: [number, number]; color: string }[]) => {
      const first = params[0];
      if (!first) return '';
      return [
        hourLabel(first.value[0], calendar.dates),
        ...params.map((p) => `${p.seriesName}: <b>${formatNumber(p.value[1])}</b>`),
      ].join('<br/>');
    },
  };
  const zoom = [
    { type: 'inside', xAxisIndex: 0 },
    { type: 'slider', xAxisIndex: 0, height: 16, bottom: 6 },
  ];
  return {
    power: {
      tooltip,
      legend: { top: 0, type: 'scroll' },
      grid: { left: 64, right: 20, top: 34, bottom: 52 },
      xAxis,
      yAxis: { type: 'value', name: unit },
      dataZoom: zoom,
      series: [
        ...present.map((t) => ({
          name: LOAD_LABELS[t],
          type: 'line',
          stack: 'loads',
          areaStyle: { opacity: 0.75 },
          lineStyle: { width: 0 },
          showSymbol: false,
          sampling: 'lttb',
          color: TYPE_COLORS[t],
          data: series(view.watts[t]),
        })),
        {
          name: 'Total',
          type: 'line',
          showSymbol: false,
          sampling: 'lttb',
          color: '#333',
          lineStyle: { width: 1 },
          data: series(total),
        },
      ],
    },
    people: {
      tooltip,
      grid: { left: 64, right: 20, top: 16, bottom: 52 },
      xAxis,
      yAxis: { type: 'value', name: 'people' },
      dataZoom: zoom,
      series: [
        {
          name: 'Occupants',
          type: 'line',
          showSymbol: false,
          sampling: 'lttb',
          step: 'end',
          color: TYPE_COLORS.people,
          areaStyle: { opacity: 0.25 },
          data: Array.from(view.people, (v, h) => [h, Number(v.toFixed(3))]),
        },
      ],
    },
  };
}
