import { useEffect, useMemo, useState } from 'react';
import type {
  CoefficientModel,
  FlowKind,
  FlowRow,
  ZoneFlowSummary,
  ZoneFlows,
} from '../../core/airflow/zoneflows';
import type { DescribedField } from '../../core/model/describe';
import { formatArea, formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { FieldValue } from './AfnPanel';

interface Props {
  onSelect: (id: number) => void;
}

const MODEL_LABELS: Record<CoefficientModel, string> = {
  constant: 'Constant (1, 0, 0, 0)',
  doe2: 'DOE-2 (0, 0, 0.224, 0)',
  blast: 'BLAST (0.606, 0.03636, 0.1177, 0)',
  custom: 'Custom',
};

/** Three significant digits for small flows (m³/s, m³/s·m²). */
function sig(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '';
  if (n === 0) return '0';
  if (Math.abs(n) >= 100) return formatNumber(n);
  return String(Number(n.toPrecision(3)));
}

/** Settings that differ from their IDD default (limits, fan, angles…), and the ventilation type. */
function settings(fields: DescribedField[]): DescribedField[] {
  return fields.filter((f) => f.value && (!f.isDefault || f.label === 'Ventilation Type'));
}

function Settings({
  fields,
  onSelect,
}: {
  fields: DescribedField[];
  onSelect: (id: number) => void;
}) {
  const shown = settings(fields);
  if (shown.length === 0) return <span className="count">—</span>;
  return (
    <>
      {shown.map((f, i) => (
        <span key={f.label} className="setting">
          {i > 0 ? ' · ' : ''}
          <span className="count">{f.label}: </span>
          <FieldValue field={f} onSelect={onSelect} />
        </span>
      ))}
    </>
  );
}

/** Infiltration (L7) and ventilation without AirflowNetwork (L8), per zone. */
export function ZoneFlowsPanel({ onSelect }: Props) {
  const [flows, setFlows] = useState<ZoneFlows | null>(null);
  const [zone, setZone] = useState<string | null>(null);

  useEffect(() => {
    idf.zoneFlows().then(setFlows);
  }, []);

  const rows = useMemo(
    () => (flows?.rows ?? []).filter((r) => !zone || r.zone === zone),
    [flows, zone],
  );
  if (!flows) return <div className="content count">Reading infiltration and ventilation…</div>;

  const of = (...kinds: FlowKind[]) => rows.filter((r) => kinds.includes(r.kind));
  const zones = flows.zones.filter(
    (z) =>
      z.infiltration.objects ||
      z.ventilation.objects ||
      z.openArea ||
      z.afn.leakage.length ||
      flows.rows.some((r) => r.zone === z.name),
  );
  const nothing =
    flows.rows.length === 0 &&
    flows.airBalance.length === 0 &&
    flows.chimneys.length === 0 &&
    zones.length === 0;
  if (nothing)
    return (
      <div className="content">
        This file has no infiltration, natural ventilation or air mixing objects.
      </div>
    );

  const infiltration = of('infiltration');
  const ventilation = of('ventilation');
  const windstack = of('windstack');
  const mixing = of('mixing', 'crossmixing');
  const zoneByName = new Map(flows.zones.map((z) => [z.name, z]));

  return (
    <div className="content wide flows">
      <h3>Zones</h3>
      <p className="count">
        Design flows: before the schedule and the weather coefficients. Click a zone to show only
        its objects.
      </p>
      <div className="table-wrap">
        <table className="grid flows-zones">
          <thead>
            <tr>
              <th>Zone</th>
              <th className="num">Volume (m³)</th>
              <th className="num" title="Gross area of outdoor walls, roofs and floors">
                Exterior area (m²)
              </th>
              <th
                className="num"
                title="Glazed area of windows and glass doors on outdoor surfaces"
              >
                Windows (m²)
              </th>
              <th className="num">Infiltration (m³/s)</th>
              <th className="num">Infiltration ACH</th>
              <th className="num">Ventilation ACH</th>
              <th className="num" title="Opening area of ZoneVentilation:WindandStackOpenArea">
                Open area (m²)
              </th>
              <th>AirflowNetwork</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <ZoneRowView key={z.name} z={z} selected={zone === z.name} onPick={setZone} />
            ))}
          </tbody>
        </table>
      </div>
      {zone && (
        <p>
          Showing the objects of <strong>{zone}</strong>.{' '}
          <button type="button" className="link" onClick={() => setZone(null)}>
            Show all zones
          </button>
        </p>
      )}

      {infiltration.length > 0 && (
        <>
          <h3>Infiltration</h3>
          <p className="count">
            EnergyPlus uses design flow × schedule × (A + B·|ΔT| + C·V + D·V²), with ΔT the indoor –
            outdoor temperature difference and V the wind speed.
          </p>
          <div className="table-wrap">
            <table className="grid flows-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Zone</th>
                  <th>Method</th>
                  <th className="num">Design (m³/s)</th>
                  <th className="num">ACH</th>
                  <th className="num">m³/s·m² floor</th>
                  <th className="num">m³/s·m² exterior</th>
                  <th>Schedule</th>
                  <th>Coefficients A, B, C, D</th>
                </tr>
              </thead>
              <tbody>
                {infiltration.map((r) => (
                  <tr key={`${r.id}-${r.zone}-${r.space ?? ''}`}>
                    <NameCell r={r} onSelect={onSelect} />
                    <ZoneCell r={r} />
                    <td>{r.method ?? <span className="count">{shortClass(r.className)}</span>}</td>
                    {r.design === undefined ? (
                      <td colSpan={4} className="count wrap" title={r.note}>
                        {r.note ? 'depends on the weather' : 'not computed'} ·{' '}
                        <Settings fields={r.fields} onSelect={onSelect} />
                      </td>
                    ) : (
                      <>
                        <td className="num">{sig(r.design)}</td>
                        <td className="num">{sig(r.ach)}</td>
                        <td className="num">{sig(r.perFloor)}</td>
                        <td className="num">{sig(r.perExterior)}</td>
                      </>
                    )}
                    <td>{r.schedule && <FieldValue field={r.schedule} onSelect={onSelect} />}</td>
                    <td>
                      {r.coefficients && (
                        <span
                          title={`A ${r.coefficients.a}, B ${r.coefficients.b}, C ${r.coefficients.c}, D ${r.coefficients.d}`}
                        >
                          {MODEL_LABELS[r.coefficients.model].split(' (')[0]}{' '}
                          <span className="count">
                            {r.coefficients.a}, {r.coefficients.b}, {r.coefficients.c},{' '}
                            {r.coefficients.d}
                          </span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {infiltration.some((r) => r.note) && (
            <ul className="plain notes">
              {[...new Set(infiltration.map((r) => r.note).filter(Boolean))].map((n) => (
                <li key={n} className="count">
                  {n}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {ventilation.length > 0 && (
        <>
          <h3>Ventilation with a design flow rate</h3>
          <p className="count">
            ZoneVentilation:DesignFlowRate runs only within its temperature and wind limits; the
            columns show the limits that are not at their default.
          </p>
          <div className="table-wrap">
            <table className="grid flows-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Zone</th>
                  <th>Method</th>
                  <th className="num">Design (m³/s)</th>
                  <th className="num">ACH</th>
                  <th>Schedule</th>
                  <th>Coefficients</th>
                  <th>Type, fan and limits</th>
                </tr>
              </thead>
              <tbody>
                {ventilation.map((r) => (
                  <tr key={`${r.id}-${r.zone}-${r.space ?? ''}`}>
                    <NameCell r={r} onSelect={onSelect} />
                    <ZoneCell r={r} />
                    <td>{r.method}</td>
                    <td className="num">{sig(r.design)}</td>
                    <td className="num">{sig(r.ach)}</td>
                    <td>{r.schedule && <FieldValue field={r.schedule} onSelect={onSelect} />}</td>
                    <td>
                      {r.coefficients ? MODEL_LABELS[r.coefficients.model].split(' (')[0] : ''}
                    </td>
                    <td className="wrap">
                      <Settings fields={r.fields} onSelect={onSelect} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {windstack.length > 0 && (
        <>
          <h3>Wind and stack open area</h3>
          <p className="count">{windstack[0]?.note}</p>
          <div className="table-wrap">
            <table className="grid flows-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Zone</th>
                  <th className="num">Opening area (m²)</th>
                  <th
                    className="num"
                    title="Opening area / glazed area of the zone's exterior windows"
                  >
                    % of windows
                  </th>
                  <th>Opening area fraction schedule</th>
                  <th>Other settings</th>
                </tr>
              </thead>
              <tbody>
                {windstack.map((r) => {
                  const area = Number(r.fields.find((f) => f.label === 'Opening Area')?.value ?? 0);
                  const windows = zoneByName.get(r.zone)?.windowArea ?? 0;
                  return (
                    <tr key={`${r.id}-${r.zone}`}>
                      <NameCell r={r} onSelect={onSelect} />
                      <ZoneCell r={r} />
                      <td className="num">{formatNumber(area)}</td>
                      <td className="num">
                        {windows > 0 ? `${formatNumber((100 * area) / windows)} %` : 'no windows'}
                      </td>
                      <td>{r.schedule && <FieldValue field={r.schedule} onSelect={onSelect} />}</td>
                      <td className="wrap">
                        <Settings
                          fields={r.fields.filter((f) => f.label !== 'Opening Area')}
                          onSelect={onSelect}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {mixing.length > 0 && (
        <>
          <h3>Air mixing between zones</h3>
          <p className="count">
            ZoneMixing moves air from the source zone into the receiving zone; ZoneCrossMixing
            exchanges the same flow in both directions.
          </p>
          <div className="table-wrap">
            <table className="grid flows-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Receiving zone</th>
                  <th>Source zone</th>
                  <th>Method</th>
                  <th className="num">Design (m³/s)</th>
                  <th className="num">ACH</th>
                  <th>Schedule</th>
                  <th>Other settings</th>
                </tr>
              </thead>
              <tbody>
                {mixing.map((r) => (
                  <tr key={`${r.id}-${r.zone}`}>
                    <NameCell r={r} onSelect={onSelect} />
                    <ZoneCell r={r} />
                    <td>
                      {r.source}
                      {r.kind === 'crossmixing' ? ' ⇄' : ''}
                    </td>
                    <td>{r.method}</td>
                    <td className="num">{sig(r.design)}</td>
                    <td className="num">{sig(r.ach)}</td>
                    <td>{r.schedule && <FieldValue field={r.schedule} onSelect={onSelect} />}</td>
                    <td className="wrap">
                      <Settings fields={r.fields} onSelect={onSelect} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {flows.airBalance.length > 0 && (
        <>
          <h3>Zone air balance</h3>
          <ul className="plain">
            {flows.airBalance
              .filter((b) => !zone || b.zone === zone)
              .map((b) => (
                <li key={b.id}>
                  <button type="button" className="ref" onClick={() => onSelect(b.id)}>
                    {b.name}
                  </button>{' '}
                  ({b.zone}): <Settings fields={b.fields} onSelect={onSelect} />
                </li>
              ))}
          </ul>
        </>
      )}

      {flows.chimneys.length > 0 && (
        <>
          <h3>Thermal chimneys</h3>
          <ul className="plain">
            {flows.chimneys.map((c) => (
              <li key={c.id}>
                <button type="button" className="ref" onClick={() => onSelect(c.id)}>
                  {c.name}
                </button>{' '}
                ({c.zone}): <Settings fields={c.fields} onSelect={onSelect} />
                {c.inlets.length > 0 && (
                  <div className="count">
                    Inlets:{' '}
                    {c.inlets
                      .map(
                        (i) =>
                          `${i.zone} (${i.distance ?? '?'} m from the top, ratio ${i.ratio ?? '?'}, ${i.area ?? '?'} m²)`,
                      )
                      .join('; ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {flows.warnings.length > 0 && (
        <div className="notice warn">
          {flows.warnings.map((w) => (
            <div key={`${w.objectId}-${w.message}`}>
              <button type="button" className="ref" onClick={() => onSelect(w.objectId)}>
                Object
              </button>{' '}
              {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function shortClass(className: string) {
  return className.replace(/^ZoneInfiltration:/, '');
}

function NameCell({ r, onSelect }: { r: FlowRow; onSelect: (id: number) => void }) {
  return (
    <td>
      <button type="button" className="ref" onClick={() => onSelect(r.id)} title={r.className}>
        {r.name}
      </button>
    </td>
  );
}

function ZoneCell({ r }: { r: FlowRow }) {
  return (
    <td>
      {r.zone}
      {r.space ? <span className="count"> · {r.space}</span> : ''}
      {r.via ? (
        <span className="count" title="Assigned through a list">
          {' '}
          (via {r.via})
        </span>
      ) : (
        ''
      )}
    </td>
  );
}

function ZoneRowView({
  z,
  selected,
  onPick,
}: {
  z: ZoneFlowSummary;
  selected: boolean;
  onPick: (zone: string) => void;
}) {
  const both = z.afn.inNetwork && (z.infiltration.objects > 0 || z.ventilation.objects > 0);
  return (
    <tr className={selected ? 'selected' : undefined}>
      <td>
        <button type="button" className="ref" onClick={() => onPick(z.name)}>
          {z.name}
        </button>
      </td>
      <td className="num">{formatNumber(z.volume)}</td>
      <td className="num">{formatNumber(z.exteriorArea)}</td>
      <td className="num">{z.windowArea ? formatNumber(z.windowArea) : ''}</td>
      <td className="num">
        {z.infiltration.objects ? sig(z.infiltration.design) : ''}
        {z.infiltration.weatherOnly ? (
          <span className="count" title="Objects whose flow depends only on the weather">
            {' '}
            +{formatInt(z.infiltration.weatherOnly)}
          </span>
        ) : (
          ''
        )}
      </td>
      <td className="num">{z.infiltration.objects ? sig(z.infiltration.ach) : ''}</td>
      <td className="num">{z.ventilation.objects ? sig(z.ventilation.ach) : ''}</td>
      <td className="num">{z.openArea ? formatArea(z.openArea) : ''}</td>
      <td>
        {z.afn.inNetwork ? (
          <span
            title={z.afn.leakage.map((l) => `${l.surface}: ${l.component} (${l.label})`).join('\n')}
          >
            in the network
            {z.afn.leakage.length > 0
              ? `, ${formatInt(z.afn.leakage.length)} leakage surfaces`
              : ''}
          </span>
        ) : (
          ''
        )}
        {both && (
          <span
            className="warn-text"
            title="EnergyPlus ignores ZoneInfiltration and ZoneVentilation in AirflowNetwork zones"
          >
            {' '}
            · also has ZoneInfiltration/Ventilation
          </span>
        )}
      </td>
    </tr>
  );
}
