/**
 * ECharts wrapper. Only the chart types the viewer uses are bundled, and this
 * module is loaded lazily with the Schedules and Loads tabs.
 */
import { HeatmapChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import type { HourTicks } from './time';

echarts.use([
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  DataZoomComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.EChartsCoreOption;

interface Props {
  option: ChartOption;
  height: number;
  dark: boolean;
  /** Charts with the same group zoom together (F8 subpanels). */
  group?: string;
  /** Ticks of the x axis, recomputed when the chart is zoomed or resized. */
  xTicks?: HourTicks;
}

export function Chart({ option, height, dark, group, xTicks }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const ticksRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, dark ? 'dark' : undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => {
      chart.resize();
      ticksRef.current();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, [dark]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-apply the option after the chart is re-created for a new theme
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption({ backgroundColor: 'transparent', ...option }, { notMerge: true });
    if (group) {
      chart.group = group;
      echarts.connect(group);
    }
    if (!xTicks) {
      ticksRef.current = () => {};
      return;
    }
    let last = '';
    const apply = () => {
      const zoom = (
        chart.getOption().dataZoom as { start?: number; end?: number }[] | undefined
      )?.[0];
      const values = xTicks(zoom?.start ?? 0, zoom?.end ?? 100, chart.getWidth());
      const key = values.join(',');
      if (key === last) return;
      last = key;
      chart.setOption({
        xAxis: { axisLabel: { customValues: values }, axisTick: { customValues: values } },
      });
    };
    ticksRef.current = apply;
    apply();
    chart.on('datazoom', apply);
    return () => {
      chart.off('datazoom', apply);
    };
  }, [option, group, dark, xTicks]);

  return <div ref={ref} className="chart" style={{ height }} />;
}
