/**
 * Values that change within the hour (tests/fixtures/schedules/HalfHour.idf):
 * five zones with one person each, an OnOff occupancy schedule that empties the
 * zones at 07:30 and fills them again at 17:30 on weekdays, 6 timesteps per hour.
 * The charts must show only 0 and 5 occupants, with the changes exactly at
 * 07:30 and 17:30, and people power as steps (occupants × activity level).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { type CalendarView, openFile, type Session, type ZoneLoadView } from '../src/core/session';
import { stepAt, stepData } from '../src/features/charts/options';
import { stepLabel } from '../src/features/charts/time';
import { diskSchemaLoader, fileBuffer } from './helpers';

const FILE = 'tests/fixtures/schedules/HalfHour.idf';

describe('loads that change within the hour', () => {
  let session: Session;
  let calendar: CalendarView;
  let view: ZoneLoadView;
  let tph = 0;
  let perDay = 0;
  let day = 0;
  beforeAll(async () => {
    session = await openFile({ name: FILE, buffer: fileBuffer(FILE) }, diskSchemaLoader());
    calendar = session.calendarView();
    tph = calendar.timestepsPerHour;
    perDay = 24 * tph;
    view = session.zoneLoads(null, false);
    // A weekday without daylight saving time.
    day = calendar.dayTypes.findIndex((t, d) => t === 'Monday' && !calendar.dst[d]);
  });

  it('computes one value per timestep', () => {
    expect(tph).toBe(6);
    expect(view.people.length).toBe(calendar.dates.length * perDay);
  });

  it('gives only 0 or 5 occupants, never a mean', () => {
    expect(new Set(view.people)).toEqual(new Set([0, 5]));
  });

  it('changes occupants exactly at 07:30 and 17:30', () => {
    const people = view.people.subarray(day * perDay, (day + 1) * perDay);
    const at = (h: number, m: number) => people[h * tph + m / 10];
    expect(at(7, 20)).toBe(5); // 07:20–07:30
    expect(at(7, 30)).toBe(0); // 07:30–07:40
    expect(at(17, 20)).toBe(0);
    expect(at(17, 30)).toBe(5);
    expect(stepLabel(day * perDay + 7 * tph + 3, calendar.dates, tph)).toMatch(/07:30–07:40$/);
  });

  it('draws occupants as steps at the exact change times', () => {
    const data = stepData([view.people], tph, 1, 3);
    const changes = data.x.filter((x) => x >= day * 24 && x < (day + 1) * 24);
    expect(changes.map((x) => x - day * 24)).toEqual([7.5, 17.5]);
    expect(new Set(data.columns[0])).toEqual(new Set([0, 5]));
    // The tooltip between two changes shows the value in effect, at its timestep.
    const pointer = stepAt(data, day * 24 + 17.45);
    expect(data.columns[0]?.[pointer.index]).toBe(0);
    expect(stepLabel(pointer.step, calendar.dates, tph)).toMatch(/17:20–17:30$/);
    expect(data.columns[0]?.[stepAt(data, day * 24 + 17.5).index]).toBe(5);
  });

  it('gives people power as occupants × activity level at every timestep', () => {
    const activity = session.schedules.timesteps('Activity') as Float32Array;
    view.watts.people.forEach((w, s) => {
      expect(w).toBeCloseTo((view.people[s] as number) * (activity[s] as number), 3);
    });
    const power = view.watts.people.subarray(day * perDay, (day + 1) * perDay);
    // 5 people × 80 W until 06:30, then × 120 W; empty from 07:30 to 17:30.
    expect(power[6 * tph + 2]).toBeCloseTo(400, 3);
    expect(power[6 * tph + 3]).toBeCloseTo(600, 3);
    expect(power[7 * tph + 3]).toBe(0);
    expect(power[17 * tph + 3]).toBeCloseTo(600, 3);
  });
});
