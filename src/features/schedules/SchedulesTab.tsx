import { useEffect, useMemo, useState } from 'react';
import { MONTH_LABELS } from '../../core/schedules/calendar';
import { USE_GROUPS } from '../../core/schedules/usage';
import type {
  CalendarView,
  DayProfiles,
  ScheduleDetail,
  ScheduleListItem,
  ZoneScheduleEntry,
} from '../../core/session';
import { formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { Chart } from '../charts/Chart';
import { heatmapOption, lineOption, profilesOption } from '../charts/options';
import { dayLabel } from '../charts/time';

interface Props {
  dark: boolean;
  onSelect: (id: number) => void;
}

/** Schedules (F1–F3, F7) and the schedules of a zone in stacked subpanels (F8). */
export default function SchedulesTab({ dark, onSelect }: Props) {
  const [mode, setMode] = useState<'schedule' | 'zone'>('schedule');
  const [calendar, setCalendar] = useState<CalendarView | null>(null);
  const [list, setList] = useState<ScheduleListItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    idf.calendar().then(setCalendar);
    idf.scheduleList().then((l) => {
      setList(l);
      setSelected((s) => s ?? l.find((x) => x.evaluable && x.uses > 0)?.name ?? l[0]?.name ?? null);
    });
  }, []);

  if (!calendar || !list) return <div className="content count">Evaluating schedules…</div>;

  return (
    <div className="schedules-tab">
      <div className="subtabs">
        <button
          type="button"
          className={mode === 'schedule' ? 'active' : ''}
          onClick={() => setMode('schedule')}
        >
          By schedule
        </button>
        <button
          type="button"
          className={mode === 'zone' ? 'active' : ''}
          onClick={() => setMode('zone')}
        >
          By zone
        </button>
        <CalendarNote calendar={calendar} />
      </div>
      {mode === 'schedule' ? (
        <div className="split">
          <ScheduleList list={list} selected={selected} onPick={setSelected} />
          <div className="split-main">
            {selected ? (
              <ScheduleView
                key={selected}
                name={selected}
                calendar={calendar}
                dark={dark}
                onSelect={onSelect}
              />
            ) : (
              <div className="content">This file has no schedules.</div>
            )}
          </div>
        </div>
      ) : (
        <ZonePanels calendar={calendar} dark={dark} onSelect={onSelect} />
      )}
    </div>
  );
}

function CalendarNote({ calendar }: { calendar: CalendarView }) {
  const holidays = calendar.dayTypes.filter(
    (t) =>
      !['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(t),
  ).length;
  const dstDays = calendar.dst.map((on, i) => (on ? i : -1)).filter((i) => i >= 0);
  return (
    <span className="calendar-note count" title={calendar.assumptions.join('\n')}>
      {calendar.year ? `${calendar.year}, ` : ''}January 1 is a {calendar.jan1} ·{' '}
      {calendar.timestepsPerHour} timesteps/h · {holidays} special days
      {dstDays.length > 0
        ? ` · DST ${dayLabel(dstDays[0] as number, calendar.dates)} – ${dayLabel(dstDays.at(-1) as number, calendar.dates)}`
        : ' · no DST'}
      {calendar.assumptions.length > 0 && (
        <span className="assume"> · {calendar.assumptions.length} assumptions ⓘ</span>
      )}
    </span>
  );
}

function ScheduleList(props: {
  list: ScheduleListItem[];
  selected: string | null;
  onPick: (name: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const [usedOnly, setUsedOnly] = useState(true);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return props.list.filter(
      (s) => (!usedOnly || s.uses > 0) && (!q || s.name.toLowerCase().includes(q)),
    );
  }, [props.list, filter, usedOnly]);
  return (
    <div className="split-list">
      <div className="tree-filter">
        <input
          type="search"
          placeholder={`Filter ${props.list.length} schedules`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="count small-check">
          <input
            type="checkbox"
            checked={usedOnly}
            onChange={(e) => setUsedOnly(e.target.checked)}
          />{' '}
          Only schedules in use
        </label>
      </div>
      {shown.map((s) => (
        <button
          type="button"
          key={s.id}
          className={`class-row${s.name === props.selected ? ' selected' : ''}`}
          onClick={() => props.onPick(s.name)}
          title={`${s.className}${s.note ? ` — ${s.note}` : ''}`}
        >
          <span className="name">
            {s.name}
            {!s.evaluable && <span className="tag">file</span>}
            {s.emsActuators && <span className="tag warn">EMS</span>}
          </span>
          <span className="count">{s.uses}</span>
        </button>
      ))}
    </div>
  );
}

function ScheduleView(props: {
  name: string;
  calendar: CalendarView;
  dark: boolean;
  onSelect: (id: number) => void;
}) {
  const { calendar } = props;
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [month, setMonth] = useState(0);
  const [profiles, setProfiles] = useState<DayProfiles | null>(null);
  const day = useMemo(() => {
    const index = calendar.dates.findIndex(([m, d]) => m === month + 1 && d === 15);
    return Math.max(0, index);
  }, [calendar, month]);

  useEffect(() => {
    idf.scheduleDetail(props.name).then(setDetail);
  }, [props.name]);
  useEffect(() => {
    idf.dayProfiles(props.name, day).then(setProfiles);
  }, [props.name, day]);

  const heatmap = useMemo(
    () => (detail?.hourly ? heatmapOption(detail.hourly, calendar, detail.info.name) : null),
    [detail, calendar],
  );
  const profile = useMemo(
    () => (profiles ? profilesOption(profiles.profiles, profiles.timestepsPerHour) : null),
    [profiles],
  );

  if (!detail) return <div className="content count">Loading…</div>;
  const { info } = detail;

  return (
    <div className="content wide">
      <div className="count">{info.className}</div>
      <h2>
        <button type="button" className="ref" onClick={() => props.onSelect(info.id)}>
          {info.name}
        </button>
      </h2>
      <p className="count">
        {info.typeLimits ? `Type limits: ${info.typeLimits} · ` : ''}
        {detail.hourly
          ? `Hourly values from ${formatNumber(detail.min)} to ${formatNumber(detail.max)}`
          : ''}
      </p>
      {info.note && <div className="notice warn">{info.note}</div>}
      {info.emsActuators && (
        <div className="notice warn">
          EMS changes this schedule during the simulation ({info.emsActuators.join(', ')}). The
          values below are the ones written in the IDF.
        </div>
      )}

      {heatmap && (
        <>
          <h3>Year (hourly, standard time)</h3>
          <Chart option={heatmap} height={300} dark={props.dark} />
        </>
      )}

      {profile && detail.hourly && (
        <>
          <h3>
            Day types on{' '}
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              aria-label="Month"
            >
              {MONTH_LABELS.map((m, i) => (
                <option key={m} value={i}>
                  {m} 15
                </option>
              ))}
            </select>
          </h3>
          <Chart option={profile} height={260} dark={props.dark} />
        </>
      )}

      <h3>Used by ({detail.uses.length})</h3>
      {detail.uses.length === 0 ? (
        <p className="count">No object uses this schedule.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>Object</th>
              <th>Field</th>
              <th>Group</th>
              <th>Zones</th>
            </tr>
          </thead>
          <tbody>
            {detail.uses.map((u) => (
              <tr key={`${u.objectId}:${u.fieldName}`}>
                <td>
                  <button type="button" className="ref" onClick={() => props.onSelect(u.objectId)}>
                    {u.objectName ?? u.className}
                  </button>
                  <div className="count">{u.className}</div>
                </td>
                <td>{u.fieldName}</td>
                <td className="count">{u.group}</td>
                <td className="count">
                  {u.zones.length > 4
                    ? `${formatInt(u.zones.length)} zones`
                    : u.zones.join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type PanelView = 'line' | 'heatmap' | 'profiles';
interface Panel {
  key: number;
  schedule: string;
  group: string;
  view: PanelView;
}

function ZonePanels(props: {
  calendar: CalendarView;
  dark: boolean;
  onSelect: (id: number) => void;
}) {
  const [zones, setZones] = useState<string[]>([]);
  const [zone, setZone] = useState<string>('');
  const [entries, setEntries] = useState<ZoneScheduleEntry[] | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [details, setDetails] = useState<Map<string, ScheduleDetail>>(new Map());
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    idf.zoneTable().then((rows) => {
      setZones(rows.map((r) => r.name));
      setZone((z) => z || rows[0]?.name || '');
    });
  }, []);

  useEffect(() => {
    if (!zone) return;
    setEntries(null);
    setPanels([]);
    idf.zoneSchedules(zone).then(setEntries);
  }, [zone]);

  const add = (entry: ZoneScheduleEntry) => {
    setPanels((p) => [
      ...p,
      { key: nextKey, schedule: entry.schedule, group: entry.group, view: 'line' },
    ]);
    setNextKey((k) => k + 1);
    if (!details.has(entry.schedule)) {
      idf.scheduleDetail(entry.schedule).then((d) => {
        if (d) setDetails((m) => new Map(m).set(entry.schedule, d));
      });
    }
  };
  const move = (key: number, delta: number) =>
    setPanels((p) => {
      const i = p.findIndex((x) => x.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j] as Panel, next[i] as Panel];
      return next;
    });

  const grouped = USE_GROUPS.map(
    (g) => [g, (entries ?? []).filter((e) => e.group === g)] as const,
  ).filter(([, l]) => l.length > 0);

  return (
    <div className="split">
      <div className="split-list">
        <div className="tree-filter">
          <select value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Zone">
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </div>
        {!entries && <p className="content count">Loading…</p>}
        {entries?.length === 0 && <p className="content count">No schedule affects this zone.</p>}
        {grouped.map(([group, list]) => (
          <div key={group}>
            <div className="list-group">{group}</div>
            {list.map((e) => (
              <div key={`${group}:${e.schedule}`} className="zone-schedule">
                <button
                  type="button"
                  className="btn small"
                  disabled={
                    !e.evaluable ||
                    panels.some((p) => p.schedule === e.schedule && p.group === group)
                  }
                  onClick={() => add(e)}
                  title="Add as a subpanel"
                >
                  +
                </button>
                <div>
                  <div>{e.schedule}</div>
                  <div className="count">
                    {e.uses
                      .map((u) => `${u.objectName ?? u.className} · ${u.fieldName}`)
                      .join('; ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="split-main">
        <div className="content wide">
          {panels.length === 0 && (
            <p className="count">
              Add the schedules of <strong>{zone}</strong> one by one with “+”. Each one gets its
              own subpanel; the time axis is shared, so zooming one zooms all.
            </p>
          )}
          {panels.map((p, i) => {
            const d = details.get(p.schedule);
            return (
              <section key={p.key} className="subpanel">
                <div className="subpanel-head">
                  <strong>{p.schedule}</strong>
                  <span className="count">{p.group}</span>
                  <select
                    value={p.view}
                    onChange={(e) =>
                      setPanels((all) =>
                        all.map((x) =>
                          x.key === p.key ? { ...x, view: e.target.value as PanelView } : x,
                        ),
                      )
                    }
                    aria-label="View"
                  >
                    <option value="line">Line</option>
                    <option value="heatmap">Heat map</option>
                    <option value="profiles">Day types</option>
                  </select>
                  <button
                    type="button"
                    className="btn small"
                    disabled={i === 0}
                    onClick={() => move(p.key, -1)}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    disabled={i === panels.length - 1}
                    onClick={() => move(p.key, 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => setPanels((all) => all.filter((x) => x.key !== p.key))}
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                  {d && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => props.onSelect(d.info.id)}
                    >
                      inspect
                    </button>
                  )}
                </div>
                {d?.hourly ? (
                  p.view === 'profiles' ? (
                    <ProfilesPanel name={p.schedule} calendar={props.calendar} dark={props.dark} />
                  ) : (
                    <Chart
                      option={
                        p.view === 'line'
                          ? lineOption(d.hourly, props.calendar, p.schedule)
                          : heatmapOption(d.hourly, props.calendar, p.schedule)
                      }
                      height={p.view === 'line' ? 180 : 240}
                      dark={props.dark}
                      group="zone-subpanels"
                    />
                  )
                ) : (
                  <p className="count">Loading…</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProfilesPanel(props: { name: string; calendar: CalendarView; dark: boolean }) {
  const [profiles, setProfiles] = useState<DayProfiles | null>(null);
  useEffect(() => {
    const day = props.calendar.dates.findIndex(([m, d]) => m === 1 && d === 15);
    idf.dayProfiles(props.name, Math.max(0, day)).then(setProfiles);
  }, [props.name, props.calendar]);
  const option = useMemo(
    () => (profiles ? profilesOption(profiles.profiles, profiles.timestepsPerHour) : null),
    [profiles],
  );
  return option ? (
    <Chart option={option} height={220} dark={props.dark} />
  ) : (
    <p className="count">Loading…</p>
  );
}
