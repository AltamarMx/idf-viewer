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
import { ScheduleSet } from '../src/core/schedules/evaluate';
import { openFile } from '../src/core/session';
import { annualCases, expand } from './annual';
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
  it('gives the occupants and internal gains of every zone, hour by hour', async () => {
    const oracle = JSON.parse(
      readFileSync(resolve(ROOT, `tests/oracles/${stem}.annual.json`), 'utf8'),
    );
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
      const ref = oracle.zones[zone.name.toUpperCase()];
      if (!ref) continue;
      const series = zoneSeries(zone, schedules);
      for (const [variable, key] of VARIABLES) {
        if (!ref[variable]) continue;
        if (key === 'lights' && daylit.has(zone.name.toLowerCase())) continue;
        // Loads driven by EMS-actuated schedules cannot match.
        const usesEms = zone.instances.some((i) => schedules.info(i.schedule)?.emsActuators);
        if (usesEms) continue;
        const theirs = expand(ref[variable]);
        const ours = key === 'count' ? series.people : series.watts[key];
        compared++;
        const bad = theirs.findIndex((v: number, h: number) => !close(ours[h] ?? Number.NaN, v));
        if (bad >= 0) {
          problems.push(
            `${zone.name} ${variable} ${oracle.calendar.dates[Math.floor(bad / 24)]} hour ${(bad % 24) + 1}: ${ours[bad]} vs ${theirs[bad]}`,
          );
        }
      }
    }
    if (Object.keys(oracle.zones).length > 0) expect(compared).toBeGreaterThan(0);
    expect(
      problems.slice(0, 12).join('\n'),
      `${problems.length} of ${compared} series differ`,
    ).toBe('');
  });
});
