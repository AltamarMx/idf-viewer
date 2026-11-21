import { useMemo } from 'react';
import { interpolateSet, type OpeningFactorSet } from '../../core/airflow/afn';
import type { AfnCard } from '../../core/airflow/card';
import { formatNumber } from '../../ui/format';
import { Chart, type ChartOption } from '../charts/Chart';
import { FieldValue } from './AfnPanel';
import { OpeningRuleView } from './OpeningRuleView';

interface Props {
  card: AfnCard;
  onSelect: (id: number) => void;
  onShow3D: (id: number) => void;
  onClose: () => void;
  dark: boolean;
}

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
          {card.rule && (
            <OpeningRuleView rule={card.rule} availability={card.availability} dark={dark} />
          )}
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
          <strong>{formatNumber(component.openArea)} m²</strong>, effective area (Cd × open area){' '}
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
      grid: { left: 44, right: 52, top: 30, bottom: 64 },
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
            lineStyle: { type: 'dashed' },
            label: { show: false },
            data: [{ xAxis: link.factor }],
          },
        },
        ...(eff.length
          ? [
              {
                name: 'Effective area (Cd × open area)',
                type: 'line',
                yAxisIndex: 1,
                showSymbol: false,
                data: eff,
              },
            ]
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
      <Chart option={option} height={260} dark={dark} />
      <p className="count chart-caption">
        How the opening behaves as it opens (opening factor 0 = closed, 1 = the opening of the last
        set). Blue, left axis: discharge coefficient Cd. Green, right axis: effective area, Cd ×
        open area, which is what sets the airflow. EnergyPlus interpolates Cd and the width and
        height factors linearly between the sets, and never opens beyond the dashed line (the
        surface's maximum opening factor).
      </p>
      <Insight card={card} sets={sets} area={area} pivoted={pivoted} />
    </>
  );
}

/** What the sets mean in practice for this surface. */
function Insight(props: {
  card: AfnCard;
  sets: OpeningFactorSet[];
  area?: number;
  pivoted: boolean;
}) {
  const { card, sets, area, pivoted } = props;
  const max = card.link.factor;
  const effective = (f: number) => {
    const s = interpolateSet(sets, f);
    const a = s && openAreaOf(s, area, pivoted);
    return s && a !== undefined ? a * s.cd : undefined;
  };
  const full = effective(max);
  const half = effective(max / 2);
  const notes: string[] = [];
  if (full && half !== undefined) {
    const ratio = half / full;
    notes.push(
      `At half of the maximum opening (${formatNumber(max / 2)}) the effective area is ${formatNumber(100 * ratio)} % of its value at the maximum${ratio < 0.3 ? ': Cd, width and height all shrink together, so a half-open window lets through much less than half' : ''}.`,
    );
  }
  const mode = card.link.controlMode.toLowerCase();
  if (mode === 'constant' || mode === 'ashrae55adaptive' || mode === 'cen15251adaptive')
    notes.push(
      `With ${card.link.controlMode} control the opening is either closed or at its maximum, so only the value at the dashed line is used.`,
    );
  if (notes.length === 0) return null;
  return (
    <ul className="plain insight">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
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
        {current ? 'maximum · ' : ''}factor {formatNumber(set.openingFactor)}
        <br />
        Cd {formatNumber(set.cd)}
      </figcaption>
    </figure>
  );
}
