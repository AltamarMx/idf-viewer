/**
 * Opening rules (L6): when an AirflowNetwork opening opens and how much, for
 * each ventilation control mode, as described in the EnergyPlus Input Output
 * Reference. Only the rule is shown: the opening hour by hour depends on the
 * temperatures of the simulation.
 *
 * Temperature and Enthalpy modulate the opening with the indoor–outdoor
 * difference D (ΔT or Δh):
 *   D ≤ lower limit          → maximum opening factor
 *   D ≥ upper limit          → maximum × minimum venting open factor
 *   in between               → linear between the two
 */

export type RuleKind = 'modulated' | 'threshold' | 'constant' | 'closed' | 'unknown';

export interface OpeningRule {
  mode: string;
  kind: RuleKind;
  /** Variable of a modulated rule. */
  variable?: 'ΔT' | 'Δh';
  units?: string;
  /** Window/Door Opening Factor of the surface. */
  maxFactor: number;
  /** Minimum venting open factor (a fraction of the maximum). */
  minFactor: number;
  lower?: number;
  upper?: number;
  /**
   * The upper limit was not above the lower limit: EnergyPlus warns and resets
   * it to 100 °C (ΔT) or 300000 J/kg (Δh). `upper` is then the reset value and
   * this is the value written in the IDF.
   */
  inputUpper?: number;
  /** What must be true for the opening to open, in order. */
  conditions: string[];
}

export interface RuleInput {
  mode: string;
  maxFactor: number;
  minFactor: number;
  deltaT: [number, number];
  deltaH: [number, number];
  setpointSchedule?: string;
  availabilitySchedule?: string;
  occupantControl?: string;
}

/** Upper limit EnergyPlus uses when the one written is not above the lower limit (checked with 26.2). */
export const UPPER_RESET = { ΔT: 100, Δh: 300000 } as const;

/** Opening factor of a modulated rule at an indoor–outdoor difference d (d > 0). */
export function modulatedFactor(rule: OpeningRule, d: number): number {
  const { lower = 0, upper = 0, maxFactor, minFactor } = rule;
  if (d <= 0) return 0;
  if (d <= lower) return maxFactor;
  if (d >= upper) return maxFactor * minFactor;
  const t = (d - lower) / (upper - lower);
  return maxFactor * (1 - t * (1 - minFactor));
}

export function openingRule(input: RuleInput): OpeningRule {
  const mode = input.mode;
  const base = { mode, maxFactor: input.maxFactor, minFactor: input.minFactor };
  const available = input.availabilitySchedule
    ? `The venting availability schedule ${input.availabilitySchedule} is above zero.`
    : 'No venting availability schedule: always available.';
  const setpoint = input.setpointSchedule
    ? `The zone air temperature is above the setpoint (${input.setpointSchedule}).`
    : 'The zone air temperature is above the setpoint (no schedule given).';
  const occupant = input.occupantControl
    ? [
        `AirflowNetwork:OccupantVentilationControl ${input.occupantControl} also applies: minimum opening and closing times and comfort limits.`,
      ]
    : [];
  const modulated = (variable: 'ΔT' | 'Δh', limits: [number, number], first: string[]) => {
    const [lower, written] = limits;
    const reset = written <= lower;
    return {
      ...base,
      kind: 'modulated' as const,
      variable,
      units: variable === 'ΔT' ? '°C' : 'J/kg',
      lower,
      upper: reset ? UPPER_RESET[variable] : written,
      inputUpper: reset ? written : undefined,
      conditions: [available, ...first, ...occupant],
    };
  };

  switch (mode.toLowerCase()) {
    case 'temperature':
      return modulated('ΔT', input.deltaT, [
        'The zone air temperature is above the outdoor temperature.',
        setpoint,
      ]);
    case 'adjacenttemperature':
      return modulated('ΔT', input.deltaT, [
        'The zone air temperature is above that of the adjacent zone (interior openings).',
        setpoint,
      ]);
    case 'enthalpy':
      return modulated('Δh', input.deltaH, [
        'The zone air enthalpy is above the outdoor enthalpy.',
        setpoint,
      ]);
    case 'adjacententhalpy':
      return modulated('Δh', input.deltaH, [
        'The zone air enthalpy is above that of the adjacent zone (interior openings).',
        setpoint,
      ]);
    case 'constant':
      return {
        ...base,
        kind: 'constant',
        conditions: [
          available,
          'Then it opens to the maximum opening factor, whatever the temperatures.',
          ...occupant,
        ],
      };
    case 'ashrae55adaptive':
    case 'cen15251adaptive': {
      const standard = mode.toLowerCase() === 'ashrae55adaptive' ? 'ASHRAE 55' : 'CEN 15251';
      return {
        ...base,
        kind: 'threshold',
        conditions: [
          available,
          `The zone operative temperature is above the ${standard} adaptive comfort temperature.`,
          'The zone air temperature is above the outdoor temperature.',
          'Then it opens to the maximum opening factor.',
          ...occupant,
        ],
      };
    }
    case 'novent':
      return {
        ...base,
        kind: 'closed',
        conditions: ['Always closed: only the leakage of the closed opening applies.'],
      };
    default:
      return { ...base, kind: 'unknown', conditions: [`Unknown control mode "${mode}".`] };
  }
}
