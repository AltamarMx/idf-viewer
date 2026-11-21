import { useMemo } from 'react';
import type { AfnCard } from '../../core/airflow/card';
import { modulatedFactor, type OpeningRule } from '../../core/airflow/rules';
import { formatInt, formatNumber } from '../../ui/format';
import { Chart, type ChartOption } from '../charts/Chart';

/** When the opening opens and how much (L6). */
export function OpeningRuleView({
  rule,
  availability,
  dark,
}: {
  rule: OpeningRule;
  availability: AfnCard['availability'];
  dark: boolean;
}) {
  return (
    <div className="opening-rule">
      {rule.kind === 'closed' ? (
        <p>{rule.conditions[0]}</p>
      ) : (
        <>
          <p className="count">{rule.mode}: the opening opens only when all of these are true.</p>
          <ol>
            {rule.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </>
      )}
      {availability && (
        <p className="count">
          {!availability.schedule
            ? 'Available every hour of the year.'
            : availability.evaluable
              ? `${availability.schedule} is above zero ${formatInt(availability.hours)} of ${formatInt(availability.total)} hours of the year (${formatNumber((100 * availability.hours) / availability.total)} %).`
              : `${availability.schedule} cannot be evaluated by the viewer (for example a Schedule:File).`}
        </p>
      )}
      {rule.kind === 'modulated' && <ModulationChart rule={rule} dark={dark} />}
    </div>
  );
}

function ModulationChart({ rule, dark }: { rule: OpeningRule; dark: boolean }) {
  const { lower = 0, upper = 0, variable, units } = rule;
  const option = useMemo<ChartOption>(() => {
    // Show the whole modulation and a bit beyond the upper limit.
    const end = rule.invalid ? Math.max(lower, 1) * 1.5 : upper + (upper - lower) * 0.15;
    const data: [number, number][] = [];
    for (let i = 1; i <= 200; i++) {
      const d = (end * i) / 200;
      data.push([d, Number(modulatedFactor(rule, d).toFixed(4))]);
    }
    const limits = rule.invalid
      ? []
      : [
          { xAxis: lower, label: { formatter: 'lower limit' } },
          { xAxis: upper, label: { formatter: 'upper limit' } },
        ];
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (ps: { value: [number, number] }[]) => {
          const p = ps[0];
          return p
            ? `${variable} ${formatNumber(p.value[0])} ${units}<br/>opening factor <b>${formatNumber(p.value[1])}</b>`
            : '';
        },
      },
      grid: { left: 48, right: 20, top: 30, bottom: 44 },
      xAxis: {
        type: 'value',
        min: 0,
        name: `${variable} indoor − outdoor (${units})`,
        nameLocation: 'middle',
        nameGap: 26,
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: Math.max(1, rule.maxFactor),
        name: 'Opening factor',
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      series: [
        {
          type: 'line',
          showSymbol: false,
          data,
          areaStyle: { opacity: 0.15 },
          markLine: {
            symbol: 'none',
            lineStyle: { type: 'dashed' },
            label: { position: 'end' },
            data: limits,
          },
        },
      ],
    };
  }, [rule, lower, upper, variable, units]);

  return (
    <>
      {rule.invalid && (
        <div className="notice warn">
          The upper limit ({formatNumber(upper)} {units}) is not above the lower limit (
          {formatNumber(lower)} {units}): EnergyPlus reports an input error.
        </div>
      )}
      <Chart option={option} height={210} dark={dark} />
      <p className="count chart-caption">
        Opening factor EnergyPlus uses once the conditions above are met. Up to the lower limit it
        opens to the maximum ({formatNumber(rule.maxFactor)}); from the upper limit on, to the
        maximum × minimum venting open factor ({formatNumber(rule.maxFactor * rule.minFactor)}); in
        between it changes linearly. The actual {variable} of each hour comes from the simulation.
      </p>
    </>
  );
}
