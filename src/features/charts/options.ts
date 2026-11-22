/** Chart options shared by the schedule and load views (F2, F3, F8, F9). */
import { MONTH_LABELS } from '../../core/schedules/calendar';
import type { CalendarView } from '../../core/session';
import type { ChartOption } from './Chart';
import { dayLabel, hourLabel, hourTickLabel, monthStarts, timeOfStep } from './time';

const AXIS = { axisLine: { show: true }, splitLine: { show: true, lineStyle: { opacity: 0.4 } } };

/** Annual heat map: day of year × hour of day (F2). */
export function heatmapOption(
  values: Float32Array,
  calendar: CalendarView,
  title: string,
  unit = '',
): ChartOption {
  const days = calendar.dates.length;
  const data: [number, number, number][] = [];
  let min = Infinity;
  let max = -Infinity;
  for (let d = 0; d < days; d++) {
    for (let h = 0; h < 24; h++) {
      const v = values[d * 24 + h] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
      data.push([d, h, Number(v.toFixed(4))]);
    }
  }
  // A constant schedule still gets a visible color.
  if (min === max) {
    if (max > 0) min = 0;
    else max = min + 1;
  }
  const starts = new Set(monthStarts(calendar.dates));
  return {
    tooltip: {
      formatter: (p: { value: [number, number, number] }) =>
        `${title}<br/>${dayLabel(p.value[0], calendar.dates)}, ${String(p.value[1]).padStart(2, '0')}:00–${String(p.value[1] + 1).padStart(2, '0')}:00<br/><b>${p.value[2]}</b> ${unit}`,
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
      data: Array.from({ length: 24 }, (_, h) => h),
      name: 'Hour',
      inverse: true,
      axisLabel: { interval: 5 },
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

/** Hourly line over the year, sharing the time axis with other subpanels (F8). */
export function lineOption(
  values: Float32Array,
  calendar: CalendarView,
  title: string,
  unit = '',
): ChartOption {
  const data = Array.from(values, (v, h) => [h, Number(v.toFixed(4))]);
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { value: [number, number] }[]) => {
        const p = params[0];
        return p
          ? `${hourLabel(p.value[0], calendar.dates)}<br/>${title}: <b>${p.value[1]}</b> ${unit}`
          : '';
      },
    },
    grid: { left: 56, right: 20, top: 12, bottom: 52 },
    xAxis: {
      type: 'value',
      min: 0,
      max: values.length,
      axisLabel: { formatter: (h: number) => hourTickLabel(h, calendar.dates) },
      ...AXIS,
    },
    yAxis: { type: 'value', name: unit, scale: true, ...AXIS },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      { type: 'slider', xAxisIndex: 0, height: 16, bottom: 6 },
    ],
    series: [
      {
        type: 'line',
        data,
        showSymbol: false,
        sampling: 'lttb',
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
