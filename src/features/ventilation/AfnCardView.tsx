import { useMemo } from 'react';
import { interpolateSet, type OpeningFactorSet } from '../../core/airflow/afn';
import type { AfnCard } from '../../core/airflow/card';
import { formatNumber } from '../../ui/format';
import { Chart, type ChartOption } from '../charts/Chart';
import { FieldValue } from './AfnPanel';

interface Props {
  card: AfnCard;
  onSelect: (id: number) => void;
  onShow3D: (id: number) => void;
  onClose: () => void;
  dark: boolean;
}

/** One line per ventilation control mode (the full rules come with L6). */
const MODE_TEXT: Record<string, string> = {
  temperature:
    'Opens when the zone is warmer than outdoors and than the setpoint; the opening goes from the maximum factor to the minimum venting open factor between the ΔT limits.',
  enthalpy:
    'Opens when the zone enthalpy is higher than outdoors and the zone is warmer than the setpoint; the opening is modulated between the Δh limits.',
  adjacenttemperature: 'Like Temperature, but compares with the adjacent zone (interior openings).',
  adjacententhalpy: 'Like Enthalpy, but compares with the adjacent zone (interior openings).',
  constant:
    'Open at the maximum opening factor whenever the venting availability schedule is above zero.',
  ashrae55adaptive:
    'Opens when the zone operative temperature is above the ASHRAE 55 adaptive comfort temperature and the zone is warmer than outdoors.',
  cen15251adaptive:
    'Opens when the zone operative temperature is above the CEN 15251 adaptive comfort temperature and the zone is warmer than outdoors.',
  novent: 'Always closed: only the leakage of the closed opening applies.',
};

const KIND_LABELS: Record<string, string> = {
  wall: 'wall',
  floor: 'floor',
  roof: 'roof',
  ceiling: 'ceiling',
  window: 'window',
  glassdoor: 'glass door',
  door: 'door',
  tdd: 'tubular daylighting device',
};

/** Opening card of one AirflowNetwork surface (L4) with its opening diagram (L5). */
export function AfnCardView({ card, onSelect, onShow3D, onClose, dark }: Props) {
  const { surface, link, component, node } = card;
  const area =
    surface.width !== undefined && surface.height !== undefined
      ? surface.width * surface.height
      : undefined;
  const modeText = MODE_TEXT[link.controlMode.toLowerCase()];

  return (
    <div className="afn-card">
      <div className="afn-card-head">
        <div>
          <strong>{surface.name}</strong>{' '}
          <span className="count">
            {surface.kind ? KIND_LABELS[surface.kind] : 'surface not found'}
            {surface.zone ? ` · ${surface.zone}` : ''}
          </span>
        </div>
        <button type="button" className="link count" onClick={onClose} title="Close the card">
          ✕
        </button>
      </div>
      <div className="count">
        {surface.width !== undefined && surface.height !== undefined
          ? `${formatNumber(surface.width)} × ${formatNumber(surface.height)} m${surface.rectangular ? '' : ` (equivalent rectangle, ${surface.equivalentMethod})`}`
          : ''}
        {surface.area !== undefined ? ` · ${formatNumber(surface.area)} m²` : ''}
      </div>
      <div className="afn-card-actions">
        {surface.id !== undefined && (
          <>
            <button type="button" className="link" onClick={() => onSelect(surface.id as number)}>
              Inspect {surface.className}
            </button>
            <button type="button" className="link" onClick={() => onShow3D(surface.id as number)}>
              Show in 3D
            </button>
          </>
        )}
      </div>
      {card.notes.map((n) => (
        <div key={n.text} className={`notice${n.kind === 'warn' ? ' warn' : ''}`}>
          {n.text}
        </div>
      ))}

      <h3>
        Surface{' '}
        <button type="button" className="link count" onClick={() => onSelect(link.objectId)}>
          AirflowNetwork:MultiZone:Surface
        </button>
      </h3>
      <table className="grid afn-fields">
        <tbody>
          {card.surfaceFields.map((f) => (
            <tr
              key={f.label}
              className={f.unused ? 'unused' : undefined}
              title={f.unused ? 'Used only for non-rectangular openings' : undefined}
            >
              <td>{f.label}</td>
              <td>
                <FieldValue field={f} onSelect={onSelect} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {card.control.length > 0 && (
        <>
          <h3>Ventilation control</h3>
          {modeText && <p className="count">{modeText}</p>}
          <table className="grid afn-fields">
            <tbody>
              {card.control.map((f) => (
                <tr
                  key={f.label}
                  className={f.unused ? 'unused' : undefined}
                  title={f.unused ? `Not used with ${link.controlMode}` : f.fieldName}
                >
                  <td>{f.label}</td>
                  <td>
                    <FieldValue field={f} onSelect={onSelect} />
                    {f.from === 'zone' && (
                      <span
                        className="tag zone"
                        title="ZoneLevel: taken from AirflowNetwork:MultiZone:Zone"
                      >
                        zone
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>
        Component{' '}
        {component.id !== undefined ? (
          <button
            type="button"
            className="link count"
            onClick={() => onSelect(component.id as number)}
          >
            {component.className}
          </button>
        ) : (
          <span className="warn-text">{component.name} does not exist</span>
        )}
      </h3>
      {component.id !== undefined && (
        <>
          <div>
            <strong>{component.name}</strong> <span className="count">{component.label}</span>
          </div>
          <table className="grid afn-fields">
            <tbody>
              {component.fields.map((f) => (
                <tr key={f.label}>
                  <td>{f.label}</td>
                  <td>
                    <FieldValue field={f} onSelect={onSelect} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {component.sets && component.sets.length > 0 && (
        <OpeningSets card={card} sets={component.sets} area={area} dark={dark} />
      )}
      {component.openArea !== undefined && (
        <p>
          At the maximum opening factor ({formatNumber(link.factor)}): open area{' '}
          <strong>{formatNumber(component.openArea)} m²</strong>, Cd × area{' '}
          <strong>{formatNumber(component.effectiveArea ?? 0)} m²</strong>
          {component.sets ? '' : ' (open area = opening factor × area of the opening)'}.
        </p>
      )}

      {node && (
        <>
          <h3>
            External node{' '}
            {node.id !== undefined && (
              <button
                type="button"
                className="link count"
                onClick={() => onSelect(node.id as number)}
              >
                AirflowNetwork:MultiZone:ExternalNode
              </button>
            )}
          </h3>
          <div>
            <strong>{node.name}</strong>
          </div>
          <table className="grid afn-fields">
            <tbody>
              {node.fields.map((f) => (
                <tr key={f.label}>
                  <td>{f.label}</td>
                  <td>
                    <FieldValue field={f} onSelect={onSelect} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {node.cp && node.cp.values.length > 0 && (
            <div className="table-wrap">
              <table className="grid cp-table">
                <tbody>
                  <tr>
                    <th>Wind direction (°)</th>
                    {node.cp.values.map((_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional values
                      <td key={i} className="num">
                        {node.cp?.directions[i] ?? ''}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th>Cp</th>
                    {node.cp.values.map((v, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional values
                      <td key={i} className="num">
                        {formatNumber(v)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {node.cp && node.cp.values.length === 0 && node.cp.sourceClass && (
            <p className="count">
              Cp from {node.cp.sourceClass}{' '}
              {node.cp.sourceId !== undefined && (
                <button
                  type="button"
                  className="ref"
                  onClick={() => onSelect(node.cp?.sourceId as number)}
                >
                  {node.cp.source}
                </button>
              )}
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Open area of a non-pivoted DetailedOpening: width × height factors × area. */
function openAreaOf(s: OpeningFactorSet, area: number | undefined, pivoted: boolean) {
  return area === undefined || pivoted ? undefined : area * s.widthFactor * s.heightFactor;
}

/** Opening factor sets of a DetailedOpening: table, diagram and Cd chart (L5). */
function OpeningSets(props: {
  card: AfnCard;
  sets: OpeningFactorSet[];
  area?: number;
  dark: boolean;
}) {
  const { card, sets, area, dark } = props;
  const { surface, link, component } = card;
  const pivoted = component.lvoType?.toLowerCase() === 'horizontallypivoted';
  const sorted = [...sets].sort((a, b) => a.openingFactor - b.openingFactor);
  const at = component.atFactor;
  const openArea = (s: OpeningFactorSet) => openAreaOf(s, area, pivoted);

  const option = useMemo<ChartOption>(() => {
    const cd: [number, number][] = [];
    const eff: [number, number][] = [];
    for (let i = 0; i <= 100; i++) {
      const f = i / 100;
      const s = interpolateSet(sets, f);
      if (!s) continue;
      cd.push([f, Number(s.cd.toFixed(4))]);
      const a = openAreaOf(s, area, pivoted);
      if (a !== undefined) eff.push([f, Number((a * s.cd).toFixed(4))]);
    }
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => formatNumber(v) },
      legend: { bottom: 0 },
      grid: { left: 44, right: 52, top: 28, bottom: 64 },
      xAxis: {
        type: 'value',
        min: 0,
        max: 1,
        name: 'Opening factor',
        nameLocation: 'middle',
        nameGap: 24,
      },
      yAxis: [
        { type: 'value', name: 'Cd', min: 0, splitLine: { lineStyle: { opacity: 0.4 } } },
        { type: 'value', name: 'm²', min: 0, splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Cd',
          type: 'line',
          showSymbol: false,
          data: cd,
          markLine: {
            symbol: 'none',
            label: { formatter: `max ${formatNumber(link.factor)}`, position: 'insideEndTop' },
            data: [{ xAxis: link.factor }],
          },
        },
        ...(eff.length
          ? [{ name: 'Cd × open area', type: 'line', yAxisIndex: 1, showSymbol: false, data: eff }]
          : []),
      ],
    };
  }, [sets, link.factor, area, pivoted]);

  return (
    <>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="num">Opening factor</th>
              <th className="num">Cd</th>
              <th className="num">Width factor</th>
              <th className="num">Height factor</th>
              <th className="num">Start height factor</th>
              {!pivoted && area !== undefined && <th className="num">Open area (m²)</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.openingFactor}>
                <SetCells set={s} area={openArea(s)} showArea={!pivoted && area !== undefined} />
              </tr>
            ))}
            {at && !sorted.some((s) => s.openingFactor === at.openingFactor) && (
              <tr className="selected" title="Interpolated at the surface's opening factor">
                <SetCells set={at} area={openArea(at)} showArea={!pivoted && area !== undefined} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!pivoted && surface.width !== undefined && surface.height !== undefined && (
        <div className="opening-diagrams">
          {[
            ...sorted,
            ...(at && !sorted.some((s) => s.openingFactor === at.openingFactor) ? [at] : []),
          ]
            .sort((a, b) => a.openingFactor - b.openingFactor)
            .map((s) => (
              <OpeningDiagram
                key={s.openingFactor}
                set={s}
                width={surface.width as number}
                height={surface.height as number}
                current={s.openingFactor === link.factor}
              />
            ))}
        </div>
      )}
      <Chart option={option} height={250} dark={dark} />
    </>
  );
}

function SetCells({
  set,
  area,
  showArea,
}: {
  set: OpeningFactorSet;
  area?: number;
  showArea: boolean;
}) {
  return (
    <>
      <td className="num">{formatNumber(set.openingFactor)}</td>
      <td className="num">{formatNumber(set.cd)}</td>
      <td className="num">{formatNumber(set.widthFactor)}</td>
      <td className="num">{formatNumber(set.heightFactor)}</td>
      <td className="num">{formatNumber(set.startHeightFactor)}</td>
      {showArea && <td className="num">{area === undefined ? '' : formatNumber(area)}</td>}
    </>
  );
}

/** The window outline and its open part for one opening factor (non-pivoted LVO). */
function OpeningDiagram(props: {
  set: OpeningFactorSet;
  width: number;
  height: number;
  current: boolean;
}) {
  const { set, width, height, current } = props;
  const box = 84;
  const scale = box / Math.max(width, height);
  const w = width * scale;
  const h = height * scale;
  const ow = Math.min(1, Math.max(0, set.widthFactor)) * w;
  const oh = Math.min(1, Math.max(0, set.heightFactor)) * h;
  const bottom = Math.min(1, Math.max(0, set.startHeightFactor)) * h;
  const x0 = (box - w) / 2;
  const y0 = (box - h) / 2;
  return (
    <figure className={`opening-diagram${current ? ' current' : ''}`}>
      <svg viewBox={`-2 -2 ${box + 4} ${box + 4}`} width={box + 4} height={box + 4} role="img">
        <title>{`Opening factor ${set.openingFactor}`}</title>
        <rect x={x0} y={y0} width={w} height={h} className="frame" />
        {ow > 0 && oh > 0 && (
          <rect x={x0} y={y0 + h - bottom - oh} width={ow} height={oh} className="open" />
        )}
      </svg>
      <figcaption>
        {current ? 'max ' : ''}
        {formatNumber(set.openingFactor)} · Cd {formatNumber(set.cd)}
      </figcaption>
    </figure>
  );
}
