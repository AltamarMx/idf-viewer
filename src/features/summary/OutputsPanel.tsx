import { useEffect, useMemo, useState } from 'react';
import type { FrequencyValue, OutputsView } from '../../core/outputs';
import { formatInt } from '../../ui/format';
import { idf } from '../../worker/client';

interface Props {
  onSelect: (id: number) => void;
}

/** Output variables, meters, reports and settings the file requests (D6). */
export function OutputsPanel({ onSelect }: Props) {
  const [view, setView] = useState<OutputsView | null>(null);
  const [frequency, setFrequency] = useState('');

  useEffect(() => {
    idf.outputs().then(setView);
  }, []);

  const variables = useMemo(
    () => (view?.variables ?? []).filter((v) => !frequency || v.frequency.value === frequency),
    [view, frequency],
  );
  const meters = useMemo(
    () => (view?.meters ?? []).filter((m) => !frequency || m.frequency.value === frequency),
    [view, frequency],
  );

  if (!view) return <div className="content count">Reading the outputs…</div>;
  const nothing =
    view.variables.length +
      view.meters.length +
      view.summaryReports.length +
      view.monthly.length ===
      0 && view.other.length === 0;

  return (
    <div className="content wide outputs">
      {nothing && <p className="count">The file does not request any output.</p>}

      {view.byFrequency.length > 0 && (
        <div className="output-frequencies">
          <button
            type="button"
            className={`chip${frequency === '' ? ' on' : ''}`}
            onClick={() => setFrequency('')}
          >
            All ({formatInt(view.variables.length)} variables, {formatInt(view.meters.length)}{' '}
            meters)
          </button>
          {view.byFrequency.map((f) => (
            <button
              key={f.frequency}
              type="button"
              className={`chip${frequency === f.frequency ? ' on' : ''}`}
              onClick={() => setFrequency(f.frequency)}
            >
              {f.frequency}: {f.variables > 0 && `${formatInt(f.variables)} variables`}
              {f.variables > 0 && f.meters > 0 && ', '}
              {f.meters > 0 && `${formatInt(f.meters)} meters`}
            </button>
          ))}
        </div>
      )}

      {view.variables.length > 0 && (
        <>
          <h3>Output variables ({formatInt(variables.length)})</h3>
          <div className="table-wrap">
            <table className="grid output-table">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Key</th>
                  <th>Frequency</th>
                  <th>Schedule</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <button type="button" className="ref" onClick={() => onSelect(v.id)}>
                        {v.name}
                      </button>
                    </td>
                    <td>{v.key === '*' ? <span className="count">* (all)</span> : v.key}</td>
                    <td>
                      <Frequency value={v.frequency} />
                    </td>
                    <td>
                      {v.schedule?.refId !== undefined ? (
                        <button
                          type="button"
                          className="ref"
                          onClick={() => onSelect(v.schedule?.refId as number)}
                        >
                          {v.schedule.value}
                        </button>
                      ) : (
                        (v.schedule?.value ?? '')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view.meters.length > 0 && (
        <>
          <h3>Meters ({formatInt(meters.length)})</h3>
          <div className="table-wrap">
            <table className="grid output-table">
              <thead>
                <tr>
                  <th>Meter</th>
                  <th>Frequency</th>
                  <th>Class</th>
                </tr>
              </thead>
              <tbody>
                {meters.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <button type="button" className="ref" onClick={() => onSelect(m.id)}>
                        {m.name}
                      </button>
                    </td>
                    <td>
                      <Frequency value={m.frequency} />
                    </td>
                    <td className="count">{m.className}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {view.summaryReports.length > 0 && (
        <>
          <h3>Summary reports</h3>
          {view.summaryReports.map((r) => (
            <p key={r.id}>
              <button type="button" className="ref" onClick={() => onSelect(r.id)}>
                Output:Table:SummaryReports
              </button>
              : {r.reports.join(', ')}
            </p>
          ))}
        </>
      )}

      {view.monthly.length > 0 && (
        <>
          <h3>Monthly tables ({formatInt(view.monthly.length)})</h3>
          <div className="period-cards">
            {view.monthly.map((t) => (
              <div key={t.id} className="layer-card">
                <div className="layer-head">
                  <button type="button" className="ref" onClick={() => onSelect(t.id)}>
                    {t.name}
                  </button>
                  {t.digits && <span className="count"> · {t.digits} decimals</span>}
                </div>
                <ul className="output-items">
                  {t.items.map((item, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a variable can repeat with another aggregation
                    <li key={i}>
                      {item.name} <span className="count">{item.aggregation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      {view.other.length > 0 && (
        <>
          <h3>Other output settings</h3>
          <div className="period-cards">
            {view.other.map((o) => (
              <div key={o.id} className="layer-card">
                <div className="layer-head">
                  <button type="button" className="ref" onClick={() => onSelect(o.id)}>
                    {o.className}
                  </button>
                </div>
                {o.fields.length === 0 ? (
                  <p className="count">No fields: the request uses its defaults.</p>
                ) : (
                  <table className="grid fields-compact">
                    <tbody>
                      {o.fields.map((f, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: extensible fields can share a label
                        <tr key={i}>
                          <td className="count">{f.label}</td>
                          <td>{f.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Frequency({ value }: { value: FrequencyValue }) {
  return (
    <>
      {value.value}
      {value.defaulted && (
        <span className="tag" title="The field is blank: EnergyPlus uses the IDD default">
          default
        </span>
      )}
    </>
  );
}
