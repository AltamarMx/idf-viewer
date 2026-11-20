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
