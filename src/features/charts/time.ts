import { MONTH_LABELS } from '../../core/schedules/calendar';

/** "Mar 10 14:00" for an hour of the year (the hour ending at that time). */
export function hourLabel(hour: number, dates: [number, number][]): string {
  const day = Math.floor(hour / 24);
  const [month, dayOfMonth] = dates[day] ?? [1, 1];
  const h = (hour % 24) + 1;
  return `${MONTH_LABELS[month - 1]} ${dayOfMonth} ${String(h).padStart(2, '0')}:00`;
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
  const minutes = Math.round((step * 60) / timestepsPerHour);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Ticks of an hourly axis: function of the zoom window (percent) and the chart width. */
export type HourTicks = (startPct: number, endPct: number, width: number) => number[];

/**
 * Ticks for an axis of hours of the run period, always on the start of a day
 * (or of a month when the window is long), so each label names the day it
 * marks. Under two days the ticks fall on whole hours.
 */
export function hourTicks(dates: [number, number][], hours: number): HourTicks {
  return (startPct, endPct, width) => {
    const start = (hours * startPct) / 100;
    const end = (hours * endPct) / 100;
    const max = Math.max(2, Math.floor(width / 80));
    if (end - start < 48) {
      for (const step of [1, 2, 3, 6, 12, 24]) {
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

/** Label of a tick of an hourly axis: the date at midnight, the time otherwise. */
export function hourTickLabel(hour: number, dates: [number, number][]): string {
  const h = Math.round(hour) % 24;
  return h === 0 ? dayLabel(Math.round(hour) / 24, dates) : `${String(h).padStart(2, '0')}:00`;
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(v);
  return out;
}
