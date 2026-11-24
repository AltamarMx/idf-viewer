import { useEffect, useState } from 'react';
import type { DescribedField } from '../../core/model/describe';
import type { PeriodRow, SiteView } from '../../core/site';
import { formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { LAND_PATH } from './worldLand';

interface Props {
  onSelect: (id: number) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Site location, design days, run periods and holidays (D5). */
export default function SitePanel({ onSelect }: Props) {
  const [view, setView] = useState<SiteView | null>(null);

  useEffect(() => {
    idf.siteView().then(setView);
  }, []);

  if (!view) return <div className="content count">Reading the site…</div>;
  const loc = view.location;

  return (
    <div className="content wide site">
      <h3>Location</h3>
      {loc ? (
        <div className="site-location">
          <SiteMap latitude={loc.latitude} longitude={loc.longitude} />
          <div>
            <p>
              <button type="button" className="ref" onClick={() => onSelect(loc.id)}>
                {loc.name || 'Site:Location'}
              </button>
            </p>
            <FieldTable fields={loc.fields} onSelect={onSelect} />
            <p className="count">
              The map is drawn in the viewer: the location is not sent to any map service.
            </p>
          </div>
        </div>
      ) : (
        <p className="count">The file has no Site:Location.</p>
      )}
      {view.notes.map((n) => (
        <div key={n.text} className="notice warn">
          {n.text}
        </div>
      ))}

      <h3>Design days</h3>
      {view.designDays.length === 0 ? (
        <p className="count">No SizingPeriod:DesignDay.</p>
      ) : (
        <div className="table-wrap">
          <table className="grid design-days">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date</th>
                <th>Day type</th>
                <th className="num">Max dry-bulb (°C)</th>
                <th className="num">Range (°C)</th>
                <th>Humidity</th>
                <th className="num">Pressure (Pa)</th>
                <th className="num">Wind (m/s)</th>
                <th>Solar model</th>
              </tr>
            </thead>
            <tbody>
              {view.designDays.map((d) => (
                <tr key={d.id}>
                  <td className="wrap">
                    <button type="button" className="ref" onClick={() => onSelect(d.id)}>
                      {d.name}
                    </button>
                  </td>
                  <td>{d.month ? `${MONTHS[d.month - 1] ?? d.month} ${d.day ?? ''}` : '—'}</td>
                  <td>
                    <Value field={d.dayType} />
                  </td>
                  <td className="num">
                    <Value field={d.maxDryBulb} />
                  </td>
                  <td className="num">
                    <Value field={d.range} />
                  </td>
                  <td>
                    <Value field={d.humidityType} />
                    {d.humidity && (
                      <>
                        {' '}
                        <Value field={d.humidity} units />
                      </>
                    )}
                  </td>
                  <td className="num">
                    <Value field={d.pressure} />
                  </td>
                  <td className="num">
                    <Value field={d.windSpeed} />
                    {d.windDirection && (
                      <span className="count">
                        {' '}
                        from <Value field={d.windDirection} />°
                      </span>
                    )}
                  </td>
                  <td>
                    <Value field={d.solarModel} />
                    {d.solar.map((f) => (
                      <span key={f.label} className="count">
                        {' '}
                        · {shortSolar(f.label)} <Value field={f} />
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.weatherFilePeriods.length > 0 && (
        <Periods
          title="Sizing periods from the weather file"
          rows={view.weatherFilePeriods}
          onSelect={onSelect}
        />
      )}

      <Periods
        title="Run periods"
        rows={view.runPeriods}
        onSelect={onSelect}
        empty="No RunPeriod: EnergyPlus runs only the sizing periods."
      />

      <h3>Holidays and daylight saving time</h3>
      {view.specialDays.length === 0 ? (
        <p className="count">No RunPeriodControl:SpecialDays.</p>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Start date</th>
                <th className="num">Days</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {view.specialDays.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button type="button" className="ref" onClick={() => onSelect(s.id)}>
                      {s.name}
                    </button>
                  </td>
                  <td>{s.start}</td>
                  <td className="num">{s.duration}</td>
                  <td>{s.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        {view.daylightSaving ? (
          <>
            Daylight saving time from {view.daylightSaving.start} to {view.daylightSaving.end}{' '}
            <button
              type="button"
              className="ref"
              onClick={() => onSelect(view.daylightSaving?.id as number)}
            >
              (RunPeriodControl:DaylightSavingTime)
            </button>
          </>
        ) : (
          <span className="count">No RunPeriodControl:DaylightSavingTime.</span>
        )}
      </p>
      <p className="count">
        Run periods may also take holidays and daylight saving time from the weather file; the
        viewer does not read weather files.
      </p>
    </div>
  );
}

function shortSolar(label: string): string {
  if (/Beam Irradiance/.test(label)) return 'taub';
  if (/Diffuse Irradiance/.test(label)) return 'taud';
  return label.replace(/ Day Schedule Name$/, ' schedule');
}

function Value({ field, units }: { field?: DescribedField; units?: boolean }) {
  if (!field || field.value === '') return <span className="count">—</span>;
  return (
    <>
      {field.value}
      {units && field.units && field.units !== 'dimensionless' ? ` ${field.units}` : ''}
      {field.defaulted && (
        <span className="tag" title="The field is blank: EnergyPlus uses the IDD default">
          default
        </span>
      )}
    </>
  );
}

function FieldTable({
  fields,
  onSelect,
}: {
  fields: DescribedField[];
  onSelect: (id: number) => void;
}) {
  return (
    <table className="grid fields-compact">
      <tbody>
        {fields.map((f) => (
          <tr key={f.label}>
            <td className="count">{f.label}</td>
            <td>
              {f.refId !== undefined ? (
                <button type="button" className="ref" onClick={() => onSelect(f.refId as number)}>
                  {f.value}
                </button>
              ) : (
                <Value field={f} units />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Periods({
  title,
  rows,
  onSelect,
  empty,
}: {
  title: string;
  rows: PeriodRow[];
  onSelect: (id: number) => void;
  empty?: string;
}) {
  return (
    <>
      <h3>{title}</h3>
      {rows.length === 0 && empty && <p className="count">{empty}</p>}
      <div className="period-cards">
        {rows.map((r) => (
          <div key={r.id} className="layer-card">
            <div className="layer-head">
              <button type="button" className="ref" onClick={() => onSelect(r.id)}>
                {r.name || '(no name)'}
              </button>
              <span className="count"> {r.className}</span>
            </div>
            <FieldTable fields={r.fields} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </>
  );
}

/** World map (equirectangular) with the site; drawn locally, no map service. */
function SiteMap({ latitude, longitude }: { latitude?: number; longitude?: number }) {
  const known = latitude !== undefined && longitude !== undefined;
  const x = (longitude ?? 0) + 180;
  const y = 90 - (latitude ?? 0);
  const lines = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
  return (
    <svg
      className="site-map"
      viewBox="0 0 360 180"
      role="img"
      aria-label={known ? `Site at latitude ${latitude}°, longitude ${longitude}°` : 'World map'}
    >
      <rect x="0" y="0" width="360" height="180" className="map-sea" />
      {lines.map((lon) => (
        <line key={`m${lon}`} x1={lon + 180} x2={lon + 180} y1="0" y2="180" className="map-grid" />
      ))}
      {[-60, -30, 0, 30, 60].map((lat) => (
        <line key={`p${lat}`} x1="0" x2="360" y1={90 - lat} y2={90 - lat} className="map-grid" />
      ))}
      <path d={LAND_PATH} className="map-land" />
      {known && (
        <>
          <circle cx={x} cy={y} r="5" className="map-halo" />
          <circle cx={x} cy={y} r="2.2" className="map-site" />
          <text
            x={x + (x > 300 ? -6 : 6)}
            y={y - 5}
            className="map-label"
            textAnchor={x > 300 ? 'end' : 'start'}
          >
            {formatNumber(latitude as number)}°, {formatNumber(longitude as number)}°
          </text>
        </>
      )}
    </svg>
  );
}
