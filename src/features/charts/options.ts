/**
 * Chart options shared by the schedule and load views (F2, F3, F8, F9). Values
 * that come from schedules are shown at timestep resolution and drawn as steps.
 */
import { MONTH_LABELS } from '../../core/schedules/calendar';
import type { CalendarView } from '../../core/session';
import type { ChartOption } from './Chart';
import { dayLabel, hourTickLabel, monthStarts, stepLabel, timeOfStep } from './time';

const AXIS = { axisLine: { show: true }, splitLine: { show: true, lineStyle: { opacity: 0.4 } } };

/**
 * Values that come from schedules, reduced to the points where some of them
 * change (x in hours of the run period, at the start of each timestep), plus a
 * last point at the end. Drawn with `step: 'end'`, each value holds until the
 * next change, so nothing is averaged or interpolated and the shape is exact.
 */
export interface StepData {
  x: number[];
  /** One column per input series, aligned with x. */
  columns: number[][];
  timestepsPerHour: number;
}

export function stepData(
  series: ArrayLike<number>[],
  timestepsPerHour: number,
  scale = 1,
  digits = 4,
): StepData {
  const n = series[0]?.length ?? 0;
  const round = (v: number) => Number((v / scale).toFixed(digits));
  const x: number[] = [];
  const columns: number[][] = series.map(() => []);
  const last: number[] = series.map(() => Number.NaN);
  for (let s = 0; s < n; s++) {
    const values = series.map((a) => round(a[s] as number));
    if (s > 0 && values.every((v, i) => v === last[i])) continue;
    x.push(s / timestepsPerHour);
    values.forEach((v, i) => {
      (columns[i] as number[]).push(v);
      last[i] = v;
    });
  }
  if (n > 0) {
    x.push(n / timestepsPerHour);
    last.forEach((v, i) => {
      (columns[i] as number[]).push(v);
    });
  }
  return { x, columns, timestepsPerHour };
}

/** ECharts [x, y] pairs of one column of step data. */
export function stepPoints(data: StepData, column: number): [number, number][] {
  const values = data.columns[column] ?? [];
  return data.x.map((x, i) => [x, values[i] as number]);
}

/**
 * Where the pointer is in step data: the timestep under it and the index of
 * the value in effect then (the last change at or before it).
 */
export function stepAt(data: StepData, hours: number): { step: number; index: number } {
  const steps = Math.round((data.x.at(-1) ?? 0) * data.timestepsPerHour);
  const step = Math.max(0, Math.min(steps - 1, Math.floor(hours * data.timestepsPerHour + 1e-6)));
  const at = step / data.timestepsPerHour + 1e-9;
  let lo = 0;
  let hi = data.x.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((data.x[mid] as number) <= at) lo = mid;
    else hi = mid - 1;
  }
  return { step, index: lo };
}

/** Rows per hour of a heat map: every timestep, or groups of them past 10 minutes. */
function rowsPerHour(timestepsPerHour: number): number {
  for (let r = Math.min(6, timestepsPerHour); r > 1; r--) if (timestepsPerHour % r === 0) return r;
  return 1;
}

/**
 * Annual heat map: day of year × time of day (F2), one row per timestep (up to
 * 6 per hour; with more, each row shows the maximum of its timesteps, never
 * their mean).
 */
export function heatmapOption(
  values: Float32Array,
  calendar: CalendarView,
  title: string,
  unit = '',
): ChartOption {
  const tph = calendar.timestepsPerHour;
  const rows = rowsPerHour(tph);
  const group = tph / rows;
  const perDay = 24 * rows;
  const days = calendar.dates.length;
  const data: [number, number, number][] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let d = 0; d < days; d++) {
    for (let r = 0; r < perDay; r++) {
      let v = -Infinity;
      for (let g = 0; g < group; g++) v = Math.max(v, values[(d * perDay + r) * group + g] ?? 0);
      if (v < min) min = v;
      if (v > max) max = v;
      data.push([d, r, Number(v.toFixed(4))]);
    }
  }
  // A constant schedule still gets a visible color.
  if (min === max) {
    if (max > 0) min = 0;
    else max = min + 1;
  }
  const starts = new Set(monthStarts(calendar.dates));
  const note = group > 1 ? ` (maximum of ${group} timesteps)` : '';
  return {
    tooltip: {
      formatter: (p: { value: [number, number, number] }) =>
        `${title}<br/>${dayLabel(p.value[0], calendar.dates)}, ${timeOfStep(p.value[1], rows)}–${timeOfStep(p.value[1] + 1, rows)}${note}<br/><b>${p.value[2]}</b> ${unit}`,
    },
    grid: { left: 48, right: 80, top: 12, bottom: 52 },
    xAxis: {
      type: 'category',
      data: calendar.dates.map((_, i) => i),
      axisLabel: {
        interval: (i: number) => starts.has(i),
        formatter: (v: string) => MONTH_LABELS[(calendar.dates[Number(v)]?.[0] ?? 1) - 1] ?? '',
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: Array.from({ length: perDay }, (_, r) => r),
      name: 'Time',
      inverse: true,
      axisLabel: { interval: 6 * rows - 1, formatter: (v: string) => timeOfStep(Number(v), rows) },
      axisTick: { interval: 6 * rows - 1 },
    },
    visualMap: {
      min,
      max,
      calculable: true,
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemHeight: 140,
      inRange: { color: ['#f7fbff', '#9ecae1', '#3182bd', '#08306b'] },
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 16, bottom: 6 },
    ],
    series: [{ type: 'heatmap', data, progressive: 0 }],
  };
}

/** Line over the year at timestep resolution, sharing the time axis with other subpanels (F8). */
export function lineOption(
  values: Float32Array,
  calendar: CalendarView,
  title: string,
  unit = '',
): ChartOption {
  const steps = stepData([values], calendar.timestepsPerHour);
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { axisValue: number }[]) => {
        const p = params[0];
        if (!p) return '';
        const { step, index } = stepAt(steps, p.axisValue);
        return `${stepLabel(step, calendar.dates, calendar.timestepsPerHour)}<br/>${title}: <b>${steps.columns[0]?.[index]}</b> ${unit}`;
      },
    },
    grid: { left: 56, right: 20, top: 12, bottom: 52 },
    xAxis: {
      type: 'value',
      min: 0,
      max: values.length / calendar.timestepsPerHour,
      axisLabel: { formatter: (h: number) => hourTickLabel(h, calendar.dates) },
      ...AXIS,
    },
    yAxis: { type: 'value', name: unit, scale: true, ...AXIS },
    // Step data keeps only the changes: zooming must not drop the point before the window.
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      { type: 'slider', xAxisIndex: 0, height: 16, bottom: 6, filterMode: 'none' },
    ],
    series: [
      {
        type: 'line',
        data: stepPoints(steps, 0),
        showSymbol: false,
        step: 'end',
        lineStyle: { width: 1.2 },
      },
    ],
  };
}

/** Day-type profiles at timestep resolution (F3). */
export function profilesOption(
  profiles: { dayType: string; values: number[] }[],
  timestepsPerHour: number,
  unit = '',
): ChartOption {
  const steps = 24 * timestepsPerHour;
  return {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${Number(v).toFixed(3)} ${unit}` },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 56, right: 20, top: 36, bottom: 44 },
    xAxis: {
      type: 'category',
      data: Array.from({ length: steps }, (_, s) => timeOfStep(s, timestepsPerHour)),
      axisLabel: { interval: timestepsPerHour * 3 - 1 },
      name: 'start of timestep',
      nameLocation: 'middle',
      nameGap: 26,
      boundaryGap: false,
    },
    yAxis: { type: 'value', name: unit, scale: true, ...AXIS },
    series: profiles.map((p) => ({
      name: p.dayType,
      type: 'line',
      step: 'end',
      showSymbol: false,
      data: p.values.map((v) => Number(v.toFixed(4))),
    })),
  };
}
