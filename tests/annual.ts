/** Shared helpers for the tests that use tests/oracles/*.annual.json. */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './helpers';

export interface Series {
  profiles: number[][];
  days: number[];
}
export interface AnnualOracle {
  calendar: { dayTypes: string[]; dates: string[]; dstDays: number[] };
  schedules: Record<string, Series>;
  designDays: Record<string, Record<string, number[]>>;
}

export function expand(series: Series): number[] {
  return series.days.flatMap((d) => series.profiles[d] as number[]);
}

const oracleDir = resolve(ROOT, 'tests/oracles');
export const annualCases = readdirSync(oracleDir)
  .filter((f) => f.endsWith('.annual.json'))
  .map((f) => f.replace(/\.annual\.json$/, ''))
  .map((stem) => {
    const idf = ['examples', 'tests/fixtures/schedules']
      .map((dir) => `${dir}/${stem}.idf`)
      .find((p) => existsSync(resolve(ROOT, p)));
    return [stem, idf] as const;
  })
  .filter((c): c is readonly [string, string] => Boolean(c[1]));
