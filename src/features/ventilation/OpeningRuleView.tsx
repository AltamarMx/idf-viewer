import { useEffect, useMemo, useState } from 'react';
import type { AfnCard, Availability } from '../../core/airflow/card';
import { modulatedFactor, type OpeningRule } from '../../core/airflow/rules';
import type { CalendarView } from '../../core/session';
import { formatInt, formatNumber } from '../../ui/format';
import { idf } from '../../worker/client';
import { Chart, type ChartOption } from '../charts/Chart';
import { lineOption } from '../charts/options';
import { hourTicks } from '../charts/time';

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
            ? 'Available at every timestep of the year.'
            : availability.evaluable
              ? `${availability.schedule} is above zero during ${formatInt(availability.steps)} of ${formatInt(availability.total)} timesteps of the year (${formatNumber(availability.steps / availability.timestepsPerHour)} h, ${formatNumber((100 * availability.steps) / availability.total)} %).`
              : `${availability.schedule} cannot be evaluated by the viewer (for example a Schedule:File).`}
        </p>
      )}
      {availability?.schedule && availability.openable && (
        <AvailabilityChart rule={rule} availability={availability} dark={dark} />
      )}
      {rule.kind === 'modulated' && <ModulationChart rule={rule} dark={dark} />}
    </div>
  );
}

/**
 * The opening factor over the year, at every timestep: the maximum opening
 * factor while the availability schedule is above zero, 0 otherwise. In
 * Constant mode this is what EnergyPlus uses; in the other modes it is the most
 * the opening can open, and the simulation decides the rest.
 */
function AvailabilityChart({
  rule,
  availability,
  dark,
}: {
  rule: OpeningRule;
  availability: Availability;
  dark: boolean;
}) {
  const [calendar, setCalendar] = useState<CalendarView | null>(null);
  useEffect(() => {
    idf.calendar().then(setCalendar);
  }, []);
  const values = availability.openable;
  const exact = rule.kind === 'constant' && !rule.occupantControl;
  const title = exact ? 'Opening factor' : 'Most it can open';
  const option = useMemo<ChartOption | null>(() => {
    if (!calendar || !values) return null;
    const base = lineOption(values, calendar, title);
    return {
      ...base,
      grid: { left: 48, right: 20, top: 30, bottom: 52 },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        name: 'Opening factor',
        axisLine: { show: true },
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
    };
  }, [calendar, values, title]);
  if (!option || !calendar || !values) return <p className="count">Evaluating…</p>;
  const schedule = availability.schedule;
  const max = formatNumber(rule.maxFactor);
  return (
    <>
      <Chart
        option={option}
        height={200}
        dark={dark}
        xTicks={hourTicks(calendar.dates, values.length / calendar.timestepsPerHour)}
      />
      <p className="count chart-caption">
        {rule.kind === 'constant'
          ? `Opening factor at every timestep: ${max} while ${schedule} is above zero, closed otherwise.`
          : `Times when ${schedule} lets the opening open, drawn at its maximum opening factor (${max}). Whether it opens, and how much, depends on the temperatures of the simulation; it never opens outside these times.`}{' '}
        Any value above zero makes it available: 0.5 opens it as much as 1.
        {rule.occupantControl &&
          ` The occupant ventilation control (${rule.occupantControl}) can also keep it closed or open at some of these times.`}
      </p>
    </>
  );
}

function ModulationChart({ rule, dark }: { rule: OpeningRule; dark: boolean }) {
  const { lower = 0, upper = 0, variable, units } = rule;
  const option = useMemo<ChartOption>(() => {
    // Show the whole modulation and a bit beyond the upper limit.
    const end = upper + (upper - lower) * 0.15;
    const data: [number, number][] = [];
    for (let i = 1; i <= 200; i++) {
      const d = (end * i) / 200;
      data.push([d, Number(modulatedFactor(rule, d).toFixed(4))]);
    }
    const limits = [
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
      {rule.inputUpper !== undefined && (
        <div className="notice warn">
          The upper limit written ({formatNumber(rule.inputUpper)} {units}) is not above the lower
          limit ({formatNumber(lower)} {units}): EnergyPlus warns and uses {formatNumber(upper)}{' '}
          {units} instead. The chart uses that value.
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
