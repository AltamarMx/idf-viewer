/**
 * Phase 2a acceptance: the calendar and every schedule match EnergyPlus hour by
 * hour for a whole year (tests/oracles/*.annual.json, from make_oracles.py --annual).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCalendar, type DayType } from '../src/core/schedules/calendar';
import { ScheduleSet } from '../src/core/schedules/evaluate';
import { openFile } from '../src/core/session';
import { type AnnualOracle, annualCases, expand } from './annual';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const loader = diskSchemaLoader();
const oracleDir = resolve(ROOT, 'tests/oracles');

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-4 + 1e-4 * Math.abs(b);

describe.each(annualCases)('%s', (stem, idf) => {
  const load = async () => {
    const oracle: AnnualOracle = JSON.parse(
      readFileSync(resolve(oracleDir, `${stem}.annual.json`), 'utf8'),
    );
    const session = await openFile({ name: idf, buffer: fileBuffer(idf) }, loader);
    const calendar = buildCalendar(session.model, session.schema);
    return {
      oracle,
      session,
      calendar,
      schedules: new ScheduleSet(session.model, session.schema, calendar),
    };
  };

  it('builds the same calendar as EnergyPlus', async () => {
    const { oracle, calendar } = await load();
    const problems: string[] = [];
    oracle.calendar.dayTypes.forEach((type, d) => {
      if (calendar.dayTypes[d] !== type)
        problems.push(`${oracle.calendar.dates[d]}: ${calendar.dayTypes[d]} vs ${type}`);
    });
    const ours = calendar.dst.flatMap((on, d) => (on ? [d] : []));
    if (JSON.stringify(ours) !== JSON.stringify(oracle.calendar.dstDays)) {
      problems.push(
        `DST days: ${ours.length} (from ${ours[0]}) vs ${oracle.calendar.dstDays.length} (from ${oracle.calendar.dstDays[0]})`,
      );
    }
    expect(problems.slice(0, 10).join('\n'), `${problems.length} differences`).toBe('');
  });

  it('evaluates every schedule like EnergyPlus, timestep by timestep', async () => {
    const { oracle, schedules, calendar } = await load();
    if (!oracle.timestep) return; // only the schedule fixtures keep timesteps
    const tph = oracle.timestep.timestepsPerHour;
    expect(calendar.timestepsPerHour).toBe(tph);
    const problems: string[] = [];
    let compared = 0;
    for (const [name, series] of Object.entries(oracle.timestep.schedules)) {
      const info = schedules.info(name);
      if (!info?.evaluable || info.emsActuators) continue;
      const ours = schedules.timesteps(name);
      const theirs = expand(series);
      compared++;
      expect(ours?.length).toBe(theirs.length);
      const bad = theirs.findIndex((v, i) => !close(ours?.[i] ?? Number.NaN, v));
      if (bad >= 0) {
        const day = Math.floor(bad / (24 * tph));
        const minute = ((bad % (24 * tph)) * 60) / tph;
        problems.push(
          `${name}: ${oracle.calendar.dates[day]} ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}: ${ours?.[bad]} vs ${theirs[bad]}`,
        );
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(
      problems.slice(0, 12).join('\n'),
      `${problems.length} of ${compared} schedules differ`,
    ).toBe('');
  });

  it('evaluates every schedule like EnergyPlus, hour by hour', async () => {
    const { oracle, schedules, calendar } = await load();
    const problems: string[] = [];
    let compared = 0;
    for (const [name, series] of Object.entries(oracle.schedules)) {
      const info = schedules.info(name);
      if (!info) continue; // schedules EnergyPlus creates internally
      // Not comparable: values from a file, or overwritten by EMS during the run.
      if (!info.evaluable || info.emsActuators) continue;
      const ours = schedules.hourly(name);
      const theirs = expand(series);
      compared++;
      const bad = theirs.findIndex((v, i) => !close(ours?.[i] ?? Number.NaN, v));
      if (bad >= 0) {
        const day = Math.floor(bad / 24);
        problems.push(
          `${name}: ${oracle.calendar.dates[day]} (${calendar.dayTypes[day]}) hour ${(bad % 24) + 1}: ${ours?.[bad]} vs ${theirs[bad]}`,
        );
      }
    }
    expect(compared).toBeGreaterThan(0);
    expect(
      problems.slice(0, 12).join('\n'),
      `${problems.length} of ${compared} schedules differ`,
    ).toBe('');
  });

  it('evaluates design days like EnergyPlus', async () => {
    const { oracle, schedules, session } = await load();
    const problems: string[] = [];
    const days = session.model.ofClass('SizingPeriod:DesignDay').map((o) => {
      const fields = session.schema?.classes['sizingperiod:designday']?.fields ?? [];
      const get = (name: string) => o.fields[fields.findIndex((f) => f.name === name)] ?? '';
      return {
        name: get('Name').toUpperCase(),
        month: Number(get('Month')),
        day: Number(get('Day of Month')),
        type: (get('Day Type') || 'SummerDesignDay') as DayType,
        dst: get('Daylight Saving Time Indicator').toLowerCase() === 'yes',
      };
    });
    for (const dd of days) {
      for (const [name, values] of Object.entries(oracle.designDays[dd.name] ?? {})) {
        const ours = schedules.designDay(name, dd.month, dd.day, dd.type, dd.dst);
        if (!ours) continue;
        const bad = values.findIndex((v, i) => !close(ours[i] ?? Number.NaN, v));
        if (bad >= 0)
          problems.push(`${dd.name} / ${name} hour ${bad + 1}: ${ours[bad]} vs ${values[bad]}`);
      }
    }
    expect(problems.slice(0, 10).join('\n'), `${problems.length} differences`).toBe('');
  });
});
