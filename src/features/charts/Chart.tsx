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
}

export function Chart({ option, height, dark, group }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, dark ? 'dark' : undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
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
  }, [option, group, dark]);

  return <div ref={ref} className="chart" style={{ height }} />;
}
