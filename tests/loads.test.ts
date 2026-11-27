/**
 * Phase 2a acceptance: occupants and internal gains per zone match EnergyPlus
 * hour by hour for a whole year (tests/oracles/*.annual.json).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGeometry } from '../src/core/geometry/build';
import { type LoadType, resolveLoads, zoneSeries } from '../src/core/loads/loads';
import { buildCalendar } from '../src/core/schedules/calendar';
import { hourlyMean, ScheduleSet } from '../src/core/schedules/evaluate';
import { openFile } from '../src/core/session';
import { type AnnualOracle, annualCases, expand } from './annual';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const VARIABLES: [string, 'count' | LoadType][] = [
  ['Zone People Occupant Count', 'count'],
  ['Zone People Total Heating Rate', 'people'],
  ['Zone Lights Electricity Rate', 'lights'],
  ['Zone Electric Equipment Electricity Rate', 'electric'],
  ['Zone Gas Equipment NaturalGas Rate', 'gas'],
  ['Zone Hot Water Equipment District Heating Water Rate', 'hotwater'],
  ['Zone Steam Equipment District Heating Steam Rate', 'steam'],
  ['Zone Other Equipment Total Heating Rate', 'other'],
];

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3 + 1e-4 * Math.abs(b);

describe.each(annualCases)('%s', (stem, idf) => {
  it.each([
    ['hour by hour', false],
    ['timestep by timestep', true],
  ])('gives the occupants and internal gains of every zone, %s', async (_, byStep) => {
    const oracle: AnnualOracle = JSON.parse(
      readFileSync(resolve(ROOT, `tests/oracles/${stem}.annual.json`), 'utf8'),
    );
    // Only the schedule fixtures keep every timestep.
    const refs = byStep ? oracle.timestep?.zones : oracle.zones;
    if (!refs) return;
    const session = await openFile({ name: idf, buffer: fileBuffer(idf) }, diskSchemaLoader());
    const geometry = buildGeometry(session.model, session.schema);
    const schedules = new ScheduleSet(
      session.model,
      session.schema,
      buildCalendar(session.model, session.schema),
    );
    const { zones } = resolveLoads(session.model, session.schema, geometry);
    const problems: string[] = [];
    let compared = 0;
    // Daylighting controls dim the lights during the simulation: not an input value.
    const daylit = new Set(
      session.model.ofClass('Daylighting:Controls').map((o) => (o.fields[1] ?? '').toLowerCase()),
    );
    for (const zone of zones) {
      const ref = refs[zone.name.toUpperCase()];
      if (!ref) continue;
      const series = zoneSeries(zone, schedules);
      for (const [variable, key] of VARIABLES) {
        if (!ref[variable]) continue;
        if (key === 'lights' && daylit.has(zone.name.toLowerCase())) continue;
        // Loads driven by EMS-actuated schedules cannot match.
        const usesEms = zone.instances.some((i) => schedules.info(i.schedule)?.emsActuators);
        if (usesEms) continue;
        const theirs = expand(ref[variable]);
        const steps = key === 'count' ? series.people : series.watts[key];
        // EnergyPlus' hourly values are the mean of the timesteps of each hour.
        const ours = byStep ? steps : hourlyMean(steps, schedules.calendar.timestepsPerHour);
        const per = byStep ? 24 * schedules.calendar.timestepsPerHour : 24;
        compared++;
        const bad = theirs.findIndex((v: number, h: number) => !close(ours[h] ?? Number.NaN, v));
        if (bad >= 0) {
          problems.push(
            `${zone.name} ${variable} ${oracle.calendar.dates[Math.floor(bad / per)]} step ${(bad % per) + 1}: ${ours[bad]} vs ${theirs[bad]}`,
          );
        }
      }
    }
    if (Object.keys(refs).length > 0) expect(compared).toBeGreaterThan(0);
    expect(
      problems.slice(0, 12).join('\n'),
      `${problems.length} of ${compared} series differ`,
    ).toBe('');
  });
});
