import { useEffect, useState } from 'react';
import { AFN_COMPONENTS } from '../../core/airflow/afn';
import type { AfnCard, AfnField, AfnOverview } from '../../core/airflow/card';
import { formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { AfnCardView } from './AfnCardView';

interface Props {
  overview: AfnOverview;
  card: string | null;
  onOpenCard: (surface: string) => void;
  onSelect: (id: number) => void;
  onShow3D: (id: number) => void;
  dark: boolean;
}

/** Settings that EnergyPlus uses only when it computes the Cp itself. */
const SURFACE_AVERAGE_ONLY = new Set([
  'Building Type',
  'Azimuth Angle of Long Axis of Building',
  'Ratio of Building Width Along Short Axis to Width Along Long Axis',
]);

const KIND_LABELS: Record<string, string> = {
  wall: 'Wall',
  floor: 'Floor',
  roof: 'Roof',
  ceiling: 'Ceiling',
  window: 'Window',
  glassdoor: 'Glass door',
  door: 'Door',
  tdd: 'Tubular daylighting',
};

export function FieldValue({
  field,
  onSelect,
}: {
  field: AfnField;
  onSelect: (id: number) => void;
}) {
  if (!field.value)
    return <span className="count">{field.blank ? `— (${field.blank})` : '—'}</span>;
  const text = `${field.value}${field.units && field.units !== 'dimensionless' ? ` ${field.units}` : ''}`;
  return (
    <>
      {field.refId !== undefined ? (
        <button type="button" className="ref" onClick={() => onSelect(field.refId as number)}>
          {field.value}
        </button>
      ) : (
        text
      )}
      {field.refId !== undefined && field.units ? ` ${field.units}` : ''}
      {field.defaulted && (
        <span className="tag" title="The field is blank: EnergyPlus uses the IDD default">
          default
        </span>
      )}
    </>
  );
}

/** AirflowNetwork summary (L3), its surfaces, and the card of one of them (L4, L5). */
export function AfnPanel({ overview, card, onOpenCard, onSelect, onShow3D, dark }: Props) {
  const [detail, setDetail] = useState<AfnCard | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (card)
      idf.afnCard(card).then((c) => {
        if (!cancelled) setDetail(c);
      });
    return () => {
      cancelled = true;
    };
  }, [card]);

  const control = overview.settings.find((f) => f.label === 'AirflowNetwork Control');
  const inAfn = overview.zones.filter((z) => z.afnZoneId !== undefined || z.surfaces > 0);
  const outside = overview.zones.filter((z) => z.afnZoneId === undefined && z.surfaces === 0);

  return (
    <div className="afn-layout">
      <div className="afn-main content wide">
        {!overview.present ? (
          <div className="notice warn">
            There are AirflowNetwork surfaces but no AirflowNetwork:SimulationControl: EnergyPlus
            does not run the network.
          </div>
        ) : !overview.active ? (
          <div className="notice warn">
            AirflowNetwork Control is {control?.value}: EnergyPlus does not run the network, so
            these settings have no effect.
          </div>
        ) : null}

        <h3>Simulation control</h3>
        <table className="grid afn-fields">
          <tbody>
            {overview.settings.map((f) => (
              <tr
                key={f.label}
                className={!overview.cpInput || !SURFACE_AVERAGE_ONLY.has(f.label) ? '' : 'unused'}
                title={
                  overview.cpInput && SURFACE_AVERAGE_ONLY.has(f.label)
                    ? 'Used only when EnergyPlus computes the Cp (SurfaceAverageCalculation)'
                    : undefined
                }
              >
                <td>{f.label}</td>
                <td>
                  <FieldValue field={f} onSelect={onSelect} />
                </td>
              </tr>
            ))}
            {overview.terrain && (
              <tr>
                <td>Terrain (Building)</td>
                <td>{overview.terrain}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="count">
          {overview.cpInput
            ? 'Wind pressure coefficients come from the external nodes (Input).'
            : 'EnergyPlus computes the wind pressure coefficients of exterior surfaces from the building type, the long axis and the width ratio (SurfaceAverageCalculation); external nodes are not needed.'}
        </p>
        {overview.controlId !== undefined && (
          <button
            type="button"
            className="link"
            onClick={() => onSelect(overview.controlId as number)}
          >
            Inspect AirflowNetwork:SimulationControl
          </button>
        )}

        <h3>Zones</h3>
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Ventilation control</th>
                <th>Setpoint / availability</th>
                <th
                  className="num"
                  title="AirflowNetwork surfaces of the zone, including the zone's side of interzone surfaces listed by the other zone"
                >
                  AFN surfaces
                </th>
                <th className="num">Operable</th>
              </tr>
            </thead>
            <tbody>
              {inAfn.map((z) => (
                <tr key={z.name}>
                  <td>
                    <button type="button" className="ref" onClick={() => onSelect(z.zoneId)}>
                      {z.name}
                    </button>
                  </td>
                  <td>
                    {z.afnZoneId !== undefined ? (
                      <button
                        type="button"
                        className="ref"
                        onClick={() => onSelect(z.afnZoneId as number)}
                      >
                        {z.mode}
                      </button>
                    ) : (
                      <span className="warn-text">No AirflowNetwork:MultiZone:Zone</span>
                    )}
                  </td>
                  <td>
                    {z.fields.map((f, i) => (
                      <span key={f.label}>
                        {i > 0 ? ' · ' : ''}
                        <span className="count">{f.label}: </span>
                        <FieldValue field={f} onSelect={onSelect} />
                      </span>
                    ))}
                  </td>
                  <td className="num">{z.surfaces}</td>
                  <td className="num">{z.operable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {outside.length > 0 && (
          <p className="count">Not in the network: {outside.map((z) => z.name).join(', ')}.</p>
        )}

        <h3>Surfaces in the network</h3>
        <div className="table-wrap">
          <table className="grid afn-surfaces">
            <thead>
              <tr>
                <th>Surface</th>
                <th>Type</th>
                <th>Zone</th>
                <th>Component</th>
                <th className="num">Factor</th>
                <th className="num">Cd</th>
                <th>Control</th>
                <th>External node</th>
              </tr>
            </thead>
            <tbody>
              {overview.surfaces.map(({ surface, kind, zone, link }) => (
                <tr
                  key={surface}
                  className={card?.toLowerCase() === surface.toLowerCase() ? 'selected' : undefined}
                >
                  <td>
                    <button
                      type="button"
                      className="ref"
                      onClick={() => onOpenCard(surface)}
                      title="Open the card"
                    >
                      {surface}
                    </button>
                  </td>
                  <td>{kind ? KIND_LABELS[kind] : <span className="warn-text">not found</span>}</td>
                  <td>{zone ?? ''}</td>
                  <td>
                    {link.component}{' '}
                    <span className={link.type === 'missing' ? 'warn-text' : 'count'}>
                      {link.type === 'missing' ? 'not found' : AFN_COMPONENTS[link.type].label}
                    </span>
                  </td>
                  <td className="num">{formatNumber(link.factor)}</td>
                  <td className="num">{link.cd === undefined ? '' : formatNumber(link.cd)}</td>
                  <td>{link.role === 'operable' ? link.controlMode : ''}</td>
                  <td>{link.externalNode ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Components</h3>
        <ul className="plain">
          {overview.components.map((c) => (
            <li key={c.type}>
              {c.label}: {formatInt(c.objects)} {c.objects === 1 ? 'object' : 'objects'}, used by{' '}
              {formatInt(c.uses)} {c.uses === 1 ? 'surface' : 'surfaces'}
            </li>
          ))}
        </ul>

        {overview.nodes.length > 0 && (
          <>
            <h3>External nodes</h3>
            <div className="table-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Node</th>
                    <th className="num">Height (m)</th>
                    <th>Wind pressure coefficients</th>
                    <th className="num">Surfaces</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.nodes.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <button type="button" className="ref" onClick={() => onSelect(n.id)}>
                          {n.name}
                        </button>
                      </td>
                      <td className="num">
                        {n.height === undefined ? '' : formatNumber(n.height)}
                      </td>
                      <td>
                        {n.cpId !== undefined ? (
                          <button
                            type="button"
                            className="ref"
                            onClick={() => onSelect(n.cpId as number)}
                          >
                            {n.cp}
                          </button>
                        ) : (
                          (n.cp ?? '')
                        )}
                      </td>
                      <td className="num">{n.uses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {overview.crackConditions.length > 0 && (
          <>
            <h3>Reference crack conditions</h3>
            {overview.crackConditions.map((c) => (
              <p key={c.id}>
                <button type="button" className="ref" onClick={() => onSelect(c.id)}>
                  {c.name}
                </button>
                {': '}
                {c.fields.map((f, i) => (
                  <span key={f.label}>
                    {i > 0 ? ' · ' : ''}
                    {f.label.replace('Reference ', '')} <FieldValue field={f} onSelect={onSelect} />
                  </span>
                ))}
              </p>
            ))}
          </>
        )}
      </div>

      <aside className="afn-card-pane">
        {!card ? (
          <div className="content count">
            Choose a surface in the table (or the component of a window in "Windows and doors") to
            see its card.
          </div>
        ) : !detail ? (
          <div className="content count">Reading…</div>
        ) : (
          <AfnCardView
            card={detail}
            onSelect={onSelect}
            onShow3D={onShow3D}
            onClose={() => onOpenCard('')}
            dark={dark}
          />
        )}
      </aside>
    </div>
  );
}
