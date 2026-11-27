/**
 * When AirflowNetwork openings may open over the year (L6), at every timestep,
 * against EnergyPlus 26.2 (tests/fixtures/schedules/Venting.idf, annual oracle):
 * - Win:South, Constant 0.5, available on weekdays 07:30–17:45 and on weekends
 *   10:15–14:00 with a value of 0.5;
 * - GlassDoor:North, Constant 0.25, available on summer nights until 06:00 and
 *   from 21:30;
 * - Win:East, Temperature 0.8, with the weekday availability.
 * The file has daylight saving time. In Constant mode the viewer's series must be
 * EnergyPlus' opening factor exactly; in other modes, an upper limit of it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { openFile, type Session } from '../src/core/session';
import { type AnnualOracle, expand } from './annual';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const FILE = 'tests/fixtures/schedules/Venting.idf';
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const VARIABLE = 'AFN Surface Venting Window or Door Opening Factor';

describe('venting availability at every timestep', () => {
  let session: Session;
  let oracle: AnnualOracle;
  const energyPlus = (surface: string) =>
    expand(
      oracle.timestep?.surfaces?.[surface.toUpperCase()]?.[VARIABLE] ?? {
        profiles: [],
        days: [],
      },
    );
  const openable = (surface: string) => {
    const values = session.afnCard(surface)?.availability?.openable;
    if (!values) throw new Error(`${surface} has no availability series`);
    return Array.from(values);
  };
  beforeAll(async () => {
    session = await openFile({ name: FILE, buffer: fileBuffer(FILE) }, diskSchemaLoader());
    oracle = JSON.parse(
      readFileSync(resolve(ROOT, 'tests/oracles/Venting.annual.json'), 'utf8'),
    ) as AnnualOracle;
  });

  it.each(['Win:South', 'GlassDoor:North'])(
    '%s (Constant) opens exactly as in EnergyPlus',
    (surface) => {
      const viewer = openable(surface);
      const reference = energyPlus(surface);
      expect(viewer.length).toBe(reference.length);
      const differ = viewer.flatMap((v, s) =>
        Math.abs(v - (reference[s] as number)) > 1e-6 ? [s] : [],
      );
      expect(differ).toEqual([]);
    },
  );

  it('opens fully when the availability is 0.5, not halfway', () => {
    const card = session.afnCard('Win:South');
    expect(new Set(card?.availability?.openable)).toEqual(new Set([0, 0.5]));
  });

  it('counts the available timesteps, not hours', () => {
    const availability = session.afnCard('Win:South')?.availability;
    const tph = 4;
    // Weekdays 07:30–17:45 (41 timesteps), other days 10:15–14:00 (15 timesteps).
    const days = session.calendarView().dayTypes;
    const weekdays = days.filter((t) => WEEKDAYS.includes(t)).length;
    // No holidays or special days in this file.
    expect(days.every((t) => [...WEEKDAYS, 'Saturday', 'Sunday'].includes(t))).toBe(true);
    expect(availability).toMatchObject({
      timestepsPerHour: tph,
      total: days.length * 24 * tph,
      steps: weekdays * 41 + (days.length - weekdays) * 15,
    });
  });

  it('Win:East (Temperature) never opens beyond the series', () => {
    const viewer = openable('Win:East');
    const reference = energyPlus('Win:East');
    expect(viewer.length).toBe(reference.length);
    const beyond = reference.flatMap((v, s) => (v > (viewer[s] as number) + 1e-6 ? [s] : []));
    expect(beyond).toEqual([]);
    // EnergyPlus does open it on some of the available timesteps.
    expect(reference.some((v) => v > 0)).toBe(true);
  });
});
