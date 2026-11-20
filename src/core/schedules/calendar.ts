/**
 * The year EnergyPlus simulates, day by day (F1): which day type each date has
 * (weekday, holiday, custom day) and whether daylight saving time is on.
 * Built from RunPeriod, RunPeriodControl:SpecialDays and
 * RunPeriodControl:DaylightSavingTime. Weather-file holidays and start days are
 * not known to the viewer; those cases are listed in `assumptions`.
 */
import type { IdfModel } from '../model/model';
import { FieldReader } from '../model/reader';
import type { Schema } from '../schema/types';

export const DAY_TYPES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Holiday',
  'SummerDesignDay',
  'WinterDesignDay',
  'CustomDay1',
  'CustomDay2',
] as const;
export type DayType = (typeof DAY_TYPES)[number];

const WEEKDAYS = DAY_TYPES.slice(0, 7) as readonly DayType[];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface YearCalendar {
  /** Calendar year when the RunPeriod gives one. */
  year?: number;
  leap: boolean;
  /** Weekday of January 1 (0 = Sunday). */
  jan1: number;
  dayTypes: DayType[];
  dst: boolean[];
  /** Month (1-12) and day of each day of the year. */
  dates: [number, number][];
  timestepsPerHour: number;
  assumptions: string[];
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function monthLengths(leap: boolean): number[] {
  return DAYS_IN_MONTH.map((d, i) => (i === 1 && leap ? 29 : d));
}

/** 0-based day of year of a month/day, or -1. */
export function dayOfYear(month: number, day: number, leap = false): number {
  const lengths = monthLengths(leap);
  if (month < 1 || month > 12 || day < 1 || day > (lengths[month - 1] as number)) return -1;
  let n = 0;
  for (let m = 0; m < month - 1; m++) n += lengths[m] as number;
  return n + day - 1;
}

/** Weekday (0 = Sunday) of a Gregorian date. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function monthIndex(text: string): number {
  const i = MONTHS.indexOf(text.slice(0, 3).toLowerCase());
  return i < 0 ? -1 : i + 1;
}

const ORDINALS: Record<string, number> = {
  '1st': 1,
  '2nd': 2,
  '3rd': 3,
  '4th': 4,
  '5th': 5,
  last: -1,
};

/**
 * Day of year of a date in any EnergyPlus format: "7/4", "July 4", "4 July",
 * "1st Monday in September", "Last Monday in May". Returns -1 when unreadable.
 */
export function parseDate(text: string, jan1: number, leap: boolean): number {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let m = /^(\d{1,2})\/(\d{1,2})(?:\/\d+)?$/.exec(t);
  if (m) return dayOfYear(Number(m[1]), Number(m[2]), leap);
  m = /^([a-z]+) (\d{1,2})$/.exec(t);
  if (m && monthIndex(m[1] as string) > 0)
    return dayOfYear(monthIndex(m[1] as string), Number(m[2]), leap);
  m = /^(\d{1,2}) ([a-z]+)$/.exec(t);
  if (m && monthIndex(m[2] as string) > 0)
    return dayOfYear(monthIndex(m[2] as string), Number(m[1]), leap);
  m = /^(1st|2nd|3rd|4th|5th|last) ([a-z]+) in ([a-z]+)$/.exec(t);
  if (m) {
    const nth = ORDINALS[m[1] as string] as number;
    const prefix = (m[2] as string).slice(0, 3);
    const weekday = WEEKDAYS.findIndex((w) => w.toLowerCase().startsWith(prefix));
    const month = monthIndex(m[3] as string);
    if (weekday < 0 || month < 0) return -1;
    const first = dayOfYear(month, 1, leap);
    const length = monthLengths(leap)[month - 1] as number;
    const firstWeekday = (jan1 + first) % 7;
    const firstMatch = (weekday - firstWeekday + 7) % 7;
    if (nth > 0) {
      const offset = firstMatch + (nth - 1) * 7;
      return offset < length ? first + offset : -1;
    }
    let offset = firstMatch;
    while (offset + 7 < length) offset += 7;
    return first + offset;
  }
  return -1;
}

export function buildCalendar(model: IdfModel, schema: Schema | undefined): YearCalendar {
  const assumptions: string[] = [];
  const reader = (key: string) =>
    model.ofClass(key).map((o) => new FieldReader(o, schema?.classes[key]));

  const timestep = reader('timestep')[0]?.num('Number of Timesteps per Hour');
  const timestepsPerHour = timestep && timestep > 0 ? timestep : 6;
  if (!timestep) assumptions.push('No Timestep object; 6 timesteps per hour assumed.');

  const rp = reader('runperiod')[0];
  let year: number | undefined;
  let jan1 = 0;
  let leap = false;
  let useWeatherHolidays = false;
  let useWeatherDst = false;
  let weekendRule = false;
  if (rp) {
    const beginMonth = rp.num('Begin Month') ?? 1;
    const beginDay = rp.num('Begin Day of Month') ?? 1;
    year = rp.num('Begin Year') ?? rp.num('Start Year');
    const dow = rp.str('Day of Week for Start Day').toLowerCase();
    if (year) {
      leap = isLeapYear(year);
      jan1 = weekdayOf(year, 1, 1);
    } else {
      let start = WEEKDAYS.findIndex((w) => w.toLowerCase() === dow);
      if (start < 0) {
        start = 0;
        assumptions.push(
          dow === 'useweatherfile'
            ? 'The start day of the week comes from the weather file; Sunday is assumed.'
            : 'The run period does not set the start day of the week; Sunday is assumed.',
        );
      }
      const offset = dayOfYear(beginMonth, beginDay, false);
      jan1 = (((start - offset) % 7) + 7) % 7;
    }
    useWeatherHolidays =
      rp.str('Use Weather File Holidays and Special Days').toLowerCase() !== 'no';
    useWeatherDst = rp.str('Use Weather File Daylight Saving Period').toLowerCase() !== 'no';
    weekendRule = rp.str('Apply Weekend Holiday Rule').toLowerCase() === 'yes';
    if (model.ofClass('runperiod').length > 1) {
      assumptions.push('Several run periods; the calendar follows the first one.');
    }
  } else {
    assumptions.push('No RunPeriod; a year starting on Sunday is assumed.');
  }
  if (useWeatherHolidays)
    assumptions.push('Holidays from the weather file are not known to the viewer.');
  if (useWeatherDst)
    assumptions.push('Daylight saving time from the weather file is not known to the viewer.');

  const days = leap ? 366 : 365;
  const dayTypes: DayType[] = Array.from(
    { length: days },
    (_, d) => WEEKDAYS[(jan1 + d) % 7] as DayType,
  );
  const dates: [number, number][] = [];
  monthLengths(leap).forEach((length, m) => {
    for (let d = 1; d <= length; d++) dates.push([m + 1, d]);
  });

  for (const sd of reader('runperiodcontrol:specialdays')) {
    const start = parseDate(sd.str('Start Date'), jan1, leap);
    if (start < 0) {
      assumptions.push(
        `Special day "${sd.str('Name')}" has a date the viewer cannot read: ${sd.str('Start Date')}.`,
      );
      continue;
    }
    const duration = Math.max(1, sd.num('Duration') ?? 1);
    const raw = sd.str('Special Day Type') || 'Holiday';
    const type = (DAY_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase()) ??
      'Holiday') as DayType;
    for (let k = 0; k < duration; k++) {
      let day = start + k;
      // Weekend rule: a holiday on a weekend is observed the following Monday.
      if (weekendRule && type === 'Holiday') {
        const weekday = (jan1 + day) % 7;
        if (weekday === 6) day += 2;
        else if (weekday === 0) day += 1;
      }
      if (day < days) dayTypes[day] = type;
    }
  }

  const dst = new Array<boolean>(days).fill(false);
  const dstObj = reader('runperiodcontrol:daylightsavingtime')[0];
  if (dstObj) {
    const from = parseDate(dstObj.str('Start Date'), jan1, leap);
    const to = parseDate(dstObj.str('End Date'), jan1, leap);
    if (from >= 0 && to >= 0) {
      for (let d = 0; d < days; d++)
        dst[d] = from <= to ? d >= from && d <= to : d >= from || d <= to;
    } else {
      assumptions.push('The daylight saving dates cannot be read.');
    }
  }

  return { year, leap, jan1, dayTypes, dst, dates, timestepsPerHour, assumptions };
}
