import { MONTH_LABELS } from '../../core/schedules/calendar';

/** "07:30" for a minute of the day (1440 is "24:00"). */
function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * "Mar 10 07:30–07:40" for a timestep of the year: the interval it covers, in
 * standard time. The value of an "Until: 07:30" belongs to the step ending at 07:30.
 */
export function stepLabel(
  step: number,
  dates: [number, number][],
  timestepsPerHour: number,
): string {
  const perDay = 24 * timestepsPerHour;
  const day = Math.floor(step / perDay);
  const s = step - day * perDay;
  const from = Math.round((s * 60) / timestepsPerHour);
  const to = Math.round(((s + 1) * 60) / timestepsPerHour);
  return `${dayLabel(day, dates)} ${clock(from)}–${clock(to)}`;
}

export function dayLabel(day: number, dates: [number, number][]): string {
  const [month, dayOfMonth] = dates[day] ?? [1, 1];
  return `${MONTH_LABELS[month - 1]} ${dayOfMonth}`;
}

/** Index of the first day of each month, for axis ticks. */
export function monthStarts(dates: [number, number][]): number[] {
  return dates.flatMap(([, d], i) => (d === 1 ? [i] : []));
}

/** Start time of a timestep, "07:30". */
export function timeOfStep(step: number, timestepsPerHour: number): string {
  return clock(Math.round((step * 60) / timestepsPerHour));
}

/** Ticks of an hourly axis: function of the zoom window (percent) and the chart width. */
export type HourTicks = (startPct: number, endPct: number, width: number) => number[];

/**
 * Ticks for an axis of hours of the run period, always on the start of a day
 * (or of a month when the window is long), so each label names the day it
 * marks. Under two days the ticks fall on whole hours, and under a few hours
 * on 10, 15 or 30 minutes.
 */
export function hourTicks(dates: [number, number][], hours: number): HourTicks {
  return (startPct, endPct, width) => {
    const start = (hours * startPct) / 100;
    const end = (hours * endPct) / 100;
    const max = Math.max(2, Math.floor(width / 80));
    if (end - start < 48) {
      for (const step of [1 / 6, 1 / 4, 1 / 2, 1, 2, 3, 6, 12, 24]) {
        if ((end - start) / step <= max) return range(Math.ceil(start / step) * step, end, step);
      }
    }
    const first = Math.ceil(start / 24);
    const last = Math.min(Math.floor(end / 24), dates.length - 1);
    const days = last - first + 1;
    for (const step of [1, 2, 3, 7, 14]) {
      if (days / step <= max) return range(first, last, step).map((d) => d * 24);
    }
    const months = monthStarts(dates).filter((d) => d >= first && d <= last);
    for (const step of [1, 2, 3, 6, 12]) {
      if (months.length / step <= max)
        return months.filter((_, i) => i % step === 0).map((d) => d * 24);
    }
    return months.slice(0, 1).map((d) => d * 24);
  };
}

/** Label of a tick of an axis in hours: the date at midnight, the time otherwise. */
export function hourTickLabel(hour: number, dates: [number, number][]): string {
  const minutes = Math.round(hour * 60);
  const m = minutes % 1440;
  return m === 0 ? dayLabel(minutes / 1440, dates) : clock(m);
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let i = 0; from + i * step <= to + 1e-9; i++) out.push(from + i * step);
  return out;
}
