/**
 * Schedule evaluator (F1): values of every schedule at every timestep of the
 * year, as EnergyPlus computes them. Day schedules are built minute by minute
 * ("Until" values, interpolation) and then reduced to timesteps:
 *   - No: value at the end of each timestep;
 *   - Average (8.x "Yes"): average of the minutes of the timestep;
 *   - Linear: values ramp from the previous "Until" value; the value at the end
 *     of each timestep is used (checked against EnergyPlus).
 * Daylight saving time shifts the schedule one hour, like EnergyPlus.
 */
import type { IdfModel } from '../model/model';
import { FieldReader, toNumber } from '../model/reader';
import type { IdfObject } from '../parser/idf';
import type { Schema } from '../schema/types';
import { DAY_TYPES, type DayType, dayOfYear, parseDate, type YearCalendar } from './calendar';

export type Interpolation = 'no' | 'average' | 'linear';

export interface DaySchedule {
  name: string;
  /** One value per timestep (24 × timesteps per hour). */
  values: Float64Array;
}

type WeekSchedule = Partial<Record<DayType, DaySchedule>>;

interface Period {
  /** Last day of year (0-based, inclusive) of this period. */
  to: number;
  week: WeekSchedule;
}

export type ScheduleKind = 'compact' | 'year' | 'constant' | 'file' | 'day' | 'week' | 'other';

export interface ScheduleInfo {
  id: number;
  name: string;
  className: string;
  kind: ScheduleKind;
  typeLimits?: string;
  /** False for Schedule:File and anything the viewer cannot evaluate. */
  evaluable: boolean;
  note?: string;
  /** EMS actuators that overwrite this schedule during the simulation. */
  emsActuators?: string[];
}

interface Compiled {
  info: ScheduleInfo;
  constant?: number;
  periods?: Period[];
}

const WEEKDAY_SET: DayType[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/** Day types named by a "For:" list or a Schedule:Week:Compact DayType List. */
function dayTypesOf(keywords: string[], assigned: Set<DayType>): DayType[] {
  const result = new Set<DayType>();
  for (const raw of keywords) {
    const k = raw.toLowerCase().replace(/^for:/, '').trim();
    if (!k) continue;
    const addAll = (types: readonly DayType[]) => {
      for (const d of types) result.add(d);
    };
    if (k === 'alldays') addAll(DAY_TYPES);
    else if (k === 'weekdays') addAll(WEEKDAY_SET);
    else if (k === 'weekends') addAll(['Saturday', 'Sunday']);
    else if (k === 'holiday' || k === 'holidays') result.add('Holiday');
    else if (k === 'allotherdays') addAll(DAY_TYPES.filter((d) => !assigned.has(d)));
    else {
      // Full names, or three-letter weekdays ("Mon").
      const match = DAY_TYPES.find(
        (d, i) =>
          d.toLowerCase() === k || (i < 7 && k.length === 3 && d.toLowerCase().startsWith(k)),
      );
      if (match) result.add(match);
    }
  }
  return [...result];
}

function parseTime(text: string): number | null {
  const m = /(\d{1,2}):(\d{2})/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function parseInterpolation(text: string): Interpolation {
  const t = text.trim().toLowerCase();
  if (t === 'average' || t === 'yes') return 'average';
  if (t === 'linear') return 'linear';
  return 'no';
}

/** Timestep values from "Until" pairs (minute of day 1..1440, value). */
export function dayFromUntils(
  untils: [number, number][],
  interpolation: Interpolation,
  timestepsPerHour: number,
): Float64Array {
  const minutes = new Float64Array(1440);
  let start = 0;
  let previous = untils[0]?.[1] ?? 0;
  for (const [end, value] of untils) {
    const stop = Math.min(Math.max(end, 0), 1440);
    for (let m = start; m < stop; m++) {
      minutes[m] =
        interpolation === 'linear' && stop > start
          ? previous + ((value - previous) * (m + 1 - start)) / (stop - start)
          : value;
    }
    if (stop > start) start = stop;
    previous = value;
  }
  // Minutes after the last "Until" keep its value.
  for (let m = start; m < 1440; m++) minutes[m] = previous;

  const perStep = 60 / timestepsPerHour;
  const steps = 24 * timestepsPerHour;
  const values = new Float64Array(steps);
  for (let s = 0; s < steps; s++) {
    const from = Math.round(s * perStep);
    const to = Math.round((s + 1) * perStep);
    if (interpolation !== 'average') {
      values[s] = minutes[to - 1] as number;
    } else {
      let sum = 0;
      for (let m = from; m < to; m++) sum += minutes[m] as number;
      values[s] = sum / (to - from);
    }
  }
  return values;
}

export class ScheduleSet {
  private readonly compiled = new Map<string, Compiled | null>();
  private readonly days = new Map<string, DaySchedule | null>();
  private readonly weeks = new Map<string, WeekSchedule | null>();
  private readonly hourlyCache = new Map<string, Float32Array | null>();
  private readonly objects = new Map<string, IdfObject>();
  readonly steps: number;

  constructor(
    private readonly model: IdfModel,
    private readonly schema: Schema | undefined,
    readonly calendar: YearCalendar,
  ) {
    this.steps = 24 * calendar.timestepsPerHour;
    for (const obj of model.objects) {
      if (obj.className.toLowerCase().startsWith('schedule:')) {
        this.objects.set((obj.fields[0] ?? '').toLowerCase(), obj);
      }
    }
    for (const obj of model.ofClass('energymanagementsystem:actuator')) {
      const r = this.reader(obj);
      if (!r.str('Actuated Component Type').toLowerCase().startsWith('schedule:')) continue;
      const key = r.str('Actuated Component Unique Name').toLowerCase();
      this.ems.set(key, [...(this.ems.get(key) ?? []), r.str('Name')]);
    }
  }

  private readonly ems = new Map<string, string[]>();

  private reader(obj: IdfObject) {
    return new FieldReader(obj, this.schema?.classes[obj.className.toLowerCase()]);
  }

  /** Full schedules (the ones other objects refer to), in file order. */
  list(): ScheduleInfo[] {
    const result: ScheduleInfo[] = [];
    for (const obj of this.model.objects) {
      const key = obj.className.toLowerCase();
      if (
        !key.startsWith('schedule:') ||
        key.startsWith('schedule:day:') ||
        key.startsWith('schedule:week:')
      )
        continue;
      const compiled = this.compile(obj.fields[0] ?? '');
      if (compiled) result.push(compiled.info);
    }
    return result;
  }

  info(name: string): ScheduleInfo | undefined {
    return this.compile(name)?.info;
  }

  private compile(name: string): Compiled | null {
    const key = name.toLowerCase();
    if (this.compiled.has(key)) return this.compiled.get(key) ?? null;
    const obj = this.objects.get(key);
    let result: Compiled | null = null;
    if (obj) {
      const cls = obj.className.toLowerCase();
      const r = this.reader(obj);
      const info: ScheduleInfo = {
        id: obj.id,
        name: obj.fields[0] ?? '',
        className: obj.className,
        kind: 'other',
        typeLimits: r.str('Schedule Type Limits Name') || undefined,
        evaluable: true,
        emsActuators: this.ems.get(key),
      };
      try {
        if (cls === 'schedule:constant') {
          info.kind = 'constant';
          result = { info, constant: r.num('Hourly Value') ?? 0 };
        } else if (cls === 'schedule:compact') {
          info.kind = 'compact';
          result = { info, periods: this.compactPeriods(obj) };
        } else if (cls === 'schedule:year') {
          info.kind = 'year';
          result = { info, periods: this.yearPeriods(obj) };
        } else if (cls.startsWith('schedule:file')) {
          info.kind = 'file';
          info.evaluable = false;
          info.note = `Values come from the file "${r.str('File Name')}" (column ${r.str('Column Number')}), which the viewer does not read.`;
          result = { info };
        } else {
          info.evaluable = false;
          info.note = 'This schedule type is not evaluated by the viewer.';
          result = { info };
        }
      } catch (error) {
        info.evaluable = false;
        info.note = `The schedule could not be evaluated: ${error instanceof Error ? error.message : String(error)}`;
        result = { info };
      }
    }
    this.compiled.set(key, result);
    return result;
  }

  private compactPeriods(obj: IdfObject): Period[] {
    const { jan1, leap, timestepsPerHour } = this.calendar;
    const tokens = obj.fields.slice(2).map((t) => t.trim());
    const periods: Period[] = [];
    let week: WeekSchedule | null = null;
    let forTypes: DayType[] = [];
    let untils: [number, number][] = [];
    let interpolation: Interpolation = 'no';
    let block = 0;

    const closeFor = () => {
      if (!week || forTypes.length === 0) return;
      const day: DaySchedule = {
        name: `${obj.fields[0]} (block ${++block})`,
        values: dayFromUntils(untils, interpolation, timestepsPerHour),
      };
      for (const t of forTypes) if (!week[t]) week[t] = day;
      forTypes = [];
      untils = [];
      interpolation = 'no';
    };

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i] as string;
      const lower = token.toLowerCase();
      if (lower.startsWith('through')) {
        closeFor();
        const to = parseDate(token.replace(/^through:?/i, ''), jan1, leap);
        if (to < 0) throw new Error(`unreadable date "${token}"`);
        week = {};
        periods.push({ to, week });
      } else if (lower.startsWith('for')) {
        closeFor();
        const assigned = new Set(Object.keys(week ?? {}) as DayType[]);
        const words = token.replace(/^for:?/i, '').split(/\s+/);
        // Day types may also continue in the following fields.
        while (
          i + 1 < tokens.length &&
          !/^(until|interpolate|through|for)/i.test(tokens[i + 1] as string)
        ) {
          words.push(...(tokens[++i] as string).split(/\s+/));
        }
        forTypes = dayTypesOf(words, assigned);
      } else if (lower.startsWith('interpolate')) {
        interpolation = parseInterpolation(token.replace(/^interpolate:?/i, ''));
      } else if (lower.startsWith('until')) {
        const minute = parseTime(token);
        const value = toNumber(tokens[++i] ?? '');
        if (minute === null || value === undefined) throw new Error(`unreadable "${token}"`);
        untils.push([minute, value]);
      }
    }
    closeFor();
    return periods;
  }

  private yearPeriods(obj: IdfObject): Period[] {
    const { leap } = this.calendar;
    const groups = new FieldReader(obj, this.schema?.classes['schedule:year']).extensible();
    const periods: { from: number; to: number; week: WeekSchedule }[] = [];
    for (let i = 0; i + 4 < groups.length; i += 5) {
      const week = this.week(groups[i] ?? '');
      const from = dayOfYear(
        toNumber(groups[i + 1] ?? '') ?? 1,
        toNumber(groups[i + 2] ?? '') ?? 1,
        leap,
      );
      const to = dayOfYear(
        toNumber(groups[i + 3] ?? '') ?? 12,
        toNumber(groups[i + 4] ?? '') ?? 31,
        leap,
      );
      if (week && from >= 0 && to >= 0) periods.push({ from, to, week });
    }
    periods.sort((a, b) => a.from - b.from);
    return periods.map((p) => ({ to: p.to, week: p.week }));
  }

  private week(name: string): WeekSchedule | null {
    const key = name.toLowerCase();
    if (this.weeks.has(key)) return this.weeks.get(key) ?? null;
    const obj = this.objects.get(key);
    let week: WeekSchedule | null = null;
    if (obj?.className.toLowerCase() === 'schedule:week:daily') {
      week = {};
      // Sunday … Saturday, Holiday, SummerDesignDay, WinterDesignDay, CustomDay1, CustomDay2
      DAY_TYPES.forEach((type, i) => {
        const day = this.day(obj.fields[i + 1] ?? '');
        if (day && week) week[type] = day;
      });
    } else if (obj?.className.toLowerCase() === 'schedule:week:compact') {
      week = {};
      const fields = obj.fields.slice(1);
      for (let i = 0; i + 1 < fields.length; i += 2) {
        const types = dayTypesOf(
          (fields[i] ?? '').split(/\s+/),
          new Set(Object.keys(week) as DayType[]),
        );
        const day = this.day(fields[i + 1] ?? '');
        for (const t of types) if (day && !week[t]) week[t] = day;
      }
    }
    this.weeks.set(key, week);
    return week;
  }

  private day(name: string): DaySchedule | null {
    const key = name.toLowerCase();
    if (this.days.has(key)) return this.days.get(key) ?? null;
    const obj = this.objects.get(key);
    const tph = this.calendar.timestepsPerHour;
    let day: DaySchedule | null = null;
    if (obj) {
      const cls = obj.className.toLowerCase();
      const r = this.reader(obj);
      if (cls === 'schedule:day:hourly') {
        const untils: [number, number][] = [];
        for (let h = 1; h <= 24; h++) untils.push([h * 60, r.num(`Hour ${h}`) ?? 0]);
        day = { name: obj.fields[0] ?? '', values: dayFromUntils(untils, 'no', tph) };
      } else if (cls === 'schedule:day:interval') {
        const values = r.extensible();
        const untils: [number, number][] = [];
        for (let i = 0; i + 1 < values.length; i += 2) {
          const minute = parseTime(values[i] ?? '');
          const value = toNumber(values[i + 1] ?? '');
          if (minute !== null && value !== undefined) untils.push([minute, value]);
        }
        day = {
          name: obj.fields[0] ?? '',
          values: dayFromUntils(untils, parseInterpolation(r.str('Interpolate to Timestep')), tph),
        };
      } else if (cls === 'schedule:day:list') {
        const step = r.num('Minutes per Item') ?? 60;
        const untils = r
          .extensible()
          .map((v, i) => [(i + 1) * step, toNumber(v) ?? 0] as [number, number]);
        day = {
          name: obj.fields[0] ?? '',
          values: dayFromUntils(untils, parseInterpolation(r.str('Interpolate to Timestep')), tph),
        };
      }
    }
    this.days.set(key, day);
    return day;
  }

  /** Timestep values of the day schedule in effect on a day of year for a day type. */
  dayValues(name: string, day: number, dayType: DayType): Float64Array | null {
    const compiled = this.compile(name);
    if (!compiled?.info.evaluable) return null;
    if (compiled.constant !== undefined)
      return new Float64Array(this.steps).fill(compiled.constant);
    const period = compiled.periods?.find((p) => day <= p.to) ?? compiled.periods?.at(-1);
    return period?.week[dayType]?.values ?? new Float64Array(this.steps);
  }

  /**
   * Hourly values for the whole year (mean of the timesteps of each hour), with
   * daylight saving time applied as EnergyPlus does: on DST days hour h uses the
   * schedule's hour h + 1. Null when the schedule cannot be evaluated.
   */
  hourly(name: string): Float32Array | null {
    const key = name.toLowerCase();
    if (this.hourlyCache.has(key)) return this.hourlyCache.get(key) ?? null;
    const compiled = this.compile(name);
    let result: Float32Array | null = null;
    if (compiled?.info.evaluable) {
      const { dayTypes, dst, timestepsPerHour: tph } = this.calendar;
      const days = dayTypes.length;
      result = new Float32Array(days * 24);
      for (let d = 0; d < days; d++) {
        const today = this.dayValues(name, d, dayTypes[d] as DayType) as Float64Array;
        const shift = dst[d] ? 1 : 0;
        const tomorrow =
          shift && d + 1 < days
            ? (this.dayValues(name, d + 1, dayTypes[d + 1] as DayType) as Float64Array)
            : today;
        for (let h = 0; h < 24; h++) {
          const hour = h + shift;
          const source = hour >= 24 ? tomorrow : today;
          const base = (hour % 24) * tph;
          let sum = 0;
          for (let s = 0; s < tph; s++) sum += source[base + s] as number;
          result[d * 24 + h] = sum / tph;
        }
      }
    }
    this.hourlyCache.set(key, result);
    return result;
  }

  /** Hourly values on a design day (its date picks the period, its day type the day schedule). */
  designDay(
    name: string,
    month: number,
    dayOfMonth: number,
    dayType: DayType,
    dst: boolean,
  ): Float32Array | null {
    const compiled = this.compile(name);
    if (!compiled?.info.evaluable) return null;
    const day = Math.max(0, dayOfYear(month, dayOfMonth, this.calendar.leap));
    const values = this.dayValues(name, day, dayType) as Float64Array;
    const tph = this.calendar.timestepsPerHour;
    const result = new Float32Array(24);
    for (let h = 0; h < 24; h++) {
      const hour = Math.min(23, h + (dst ? 1 : 0));
      let sum = 0;
      for (let s = 0; s < tph; s++) sum += values[hour * tph + s] as number;
      result[h] = sum / tph;
    }
    return result;
  }
}
