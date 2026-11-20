import { useEffect, useMemo, useState } from 'react';
import type { FileSummary } from '../../core/session';
import type { BuildingSummary } from '../../core/summary';
import { formatArea, formatBytes, formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';

/** Summary dashboard (D1) and envelope by orientation (D2). */
export function FileOverview({ summary }: { summary: FileSummary }) {
  const [building, setBuilding] = useState<BuildingSummary | null>(null);
  const r = summary.resolution;

  useEffect(() => {
    let cancelled = false;
    idf.buildingSummary().then((b) => {
      if (!cancelled) setBuilding(b);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, { classes: number; objects: number }>();
    for (const cls of summary.classes) {
      const entry = map.get(cls.group) ?? { classes: 0, objects: 0 };
      entry.classes++;
      entry.objects += cls.count;
      map.set(cls.group, entry);
    }
    return [...map.entries()];
  }, [summary]);

  const loc = building?.location;

  return (
    <div className="content wide">
      <h2>{building?.buildingName || summary.fileName}</h2>
      {r.kind === 'nearest' || r.kind === 'none' ? (
        <div className="notice warn">{r.message}</div>
      ) : (
        r.message && <div className="notice">{r.message}</div>
      )}

      <div className="facts">
        <Fact
          label="EnergyPlus version"
          value={r.fileVersion ?? '—'}
          detail={r.kind === 'none' ? 'no schema' : `schema ${r.schemaVersion}`}
        />
        <Fact
          label="Location"
          value={loc?.name || '—'}
          detail={
            loc
              ? `${formatNumber(loc.latitude ?? 0)}°, ${formatNumber(loc.longitude ?? 0)}° · UTC${(loc.timeZone ?? 0) >= 0 ? '+' : ''}${loc.timeZone ?? 0} · ${formatNumber(loc.elevation ?? 0)} m`
              : undefined
          }
        />
        <Fact
          label="Run period"
          value={
            building?.runPeriods[0]
              ? `${building.runPeriods[0].from} – ${building.runPeriods[0].to}`
              : '—'
          }
          detail={
            building && building.runPeriods.length > 1
              ? `+${building.runPeriods.length - 1} more`
              : undefined
          }
        />
        <Fact
          label="Timesteps per hour"
          value={building?.timestepsPerHour ? String(building.timestepsPerHour) : '—'}
        />
        <Fact label="Design days" value={building ? String(building.designDays.length) : '—'} />
        <Fact label="North axis" value={building ? `${formatNumber(building.northAxis)}°` : '—'} />
      </div>

      {building && (
        <>
          <h3>Building</h3>
          <div className="facts">
            <Fact
              label="Zones"
              value={formatInt(building.counts.zones)}
              detail={building.counts.spaces ? `${building.counts.spaces} spaces` : undefined}
            />
            <Fact label="Surfaces" value={formatInt(building.counts.baseSurfaces)} />
            <Fact label="Windows and doors" value={formatInt(building.counts.subsurfaces)} />
            <Fact label="Shading surfaces" value={formatInt(building.counts.shading)} />
            <Fact
              label="Total floor area"
              value={formatArea(building.floorArea.total)}
              detail="with zone multipliers"
            />
            <Fact
              label="Conditioned floor area"
              value={formatArea(building.floorArea.conditioned)}
              detail={`${building.conditionedZones.length} zones with HVAC connections`}
            />
            {building.floorArea.excluded > 0 && (
              <Fact
                label="Not part of total area"
                value={formatArea(building.floorArea.excluded)}
              />
            )}
          </div>

          <h3>Envelope by orientation</h3>
          <table className="grid envelope">
            <thead>
              <tr>
                <th />
                {building.envelope.map((row) => (
                  <th key={row.orientation} className="num">
                    {row.orientation}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Exterior wall area (gross)</td>
                {building.envelope.map((row) => (
                  <td key={row.orientation} className="num">
                    {formatArea(row.grossWallArea)}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Window area (with frames)</td>
                {building.envelope.map((row) => (
                  <td key={row.orientation} className="num">
                    {formatArea(row.windowArea)}
                  </td>
                ))}
              </tr>
              <tr>
                <td>Window-wall ratio</td>
                {building.envelope.map((row) => (
                  <td key={row.orientation} className="num">
                    {formatNumber(row.wwr)} %
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="count">
            Walls with an Outdoors boundary condition, by true azimuth: North 315°–45°, East
            45°–135°, South 135°–225°, West 225°–315°. Areas include zone multipliers.
          </p>
        </>
      )}

      <h3>File</h3>
      <div className="facts">
        <Fact
          label="Objects"
          value={formatInt(summary.objectCount)}
          detail={`${summary.classes.length} classes`}
        />
        <Fact label="Lines" value={formatInt(summary.lineCount)} />
        <Fact
          label="Size"
          value={formatBytes(summary.size)}
          detail={summary.encoding.toUpperCase()}
        />
      </div>

      <h3>Objects by group</h3>
      <table className="grid">
        <thead>
          <tr>
            <th>Group</th>
            <th className="num">Classes</th>
            <th className="num">Objects</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, entry]) => (
            <tr key={group}>
              <td>{group}</td>
              <td className="num">{formatInt(entry.classes)}</td>
              <td className="num">{formatInt(entry.objects)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fact({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="fact">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {detail && <div className="detail">{detail}</div>}
    </div>
  );
}
