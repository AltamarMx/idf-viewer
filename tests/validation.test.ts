/**
 * Checks against the IDD of the file's version (H3) and unused objects (H4).
 */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openFile } from '../src/core/session';
import type { Problem } from '../src/core/validation/problems';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();
const problems = async (path: string) =>
  (await openFile({ name: path, buffer: fileBuffer(path) }, loader)).problems();
const fromText = async (text: string) =>
  (await openFile({ name: 'text.idf', text }, loader)).problems();
const messages = (list: Problem[], categories: Problem['category'][]) =>
  list.filter((p) => categories.includes(p.category)).map((p) => `${p.severity}: ${p.message}`);

describe('Validation.idf', () => {
  const ready = problems('tests/fixtures/validation/Validation.idf');

  it('finds the field and object mistakes, with their line', async () => {
    const list = await ready;
    expect(messages(list, ['Field', 'Object'])).toEqual([
      'error: Only one Timestep is allowed; the file has 2.',
      'error: Material "BAD MATERIAL": Roughness "VeryVeryRough" is not one of its options (VeryRough, Rough, MediumRough, MediumSmooth, Smooth, VerySmooth).',
      'error: Material "BAD MATERIAL": Thickness must be a number, not "thick".',
      'error: Material "BAD MATERIAL": Conductivity is required and blank.',
      'error: Material "BAD MATERIAL": Specific Heat is 50; it must be at least 100.',
      'error: Material "BAD MATERIAL": Solar Absorptance is 1.2; it must be at most 1.',
      'error: Only one SimulationControl is allowed; the file has 2.',
      'error: SimulationControl: Maximum Number of HVAC Sizing Simulation Passes must be a whole number, not 1.5.',
      'error: People "TEST PEOPLE": Number of People "autosize" is not allowed here.',
      'warning: Material:AirGap "EXTRA AIR GAP" has 3 fields; EnergyPlus 26.2 defines 2 for this class.',
    ]);
    // The line of the field, not of the object.
    const thickness = list.find((p) => p.message.includes('Thickness must be a number'));
    expect(thickness?.line).toBe(
      (list.find((p) => p.message.includes('Roughness "VeryVeryRough"'))?.line ?? 0) + 1,
    );
  });

  it('lists unused materials, constructions, schedules and curves', async () => {
    const unused = (await ready)
      .filter((p) => p.category === 'Unused')
      .map((p) => p.message.replace(' is not used by any object.', ''));
    expect(unused).toEqual([
      'Material "BAD MATERIAL" (Material)',
      'Material "EXTRA AIR GAP" (Material:AirGap)',
      'Material "UNUSED LAYER" (Material:NoMass)',
      'Construction "UNUSED WALL" (Construction)',
      'Schedule "UnusedSchedule" (Schedule:Constant)',
      'Curve "UNUSED CURVE" (Curve:Linear)',
    ]);
    // Named only by an EMS actuator or an output request: in use.
    expect(unused.join()).not.toMatch(/EmsSchedule|ReportedSchedule/);
    expect(
      (await ready).filter((p) => p.category === 'Unused').every((p) => p.severity === 'info'),
    ).toBe(true);
  });
});

describe('files that EnergyPlus reads without errors', () => {
  // The gallery runs in EnergyPlus 26.2; the 8.x and 9.x fixtures are copies of
  // its example files. The fixtures with mistakes made on purpose are left out.
  const withMistakes = new Set(['AfnErrors.idf', 'Constructions.idf', 'Validation.idf']);
  const files = [
    ...readdirSync('examples')
      .filter((f) => f.endsWith('.idf') && !f.startsWith('1ra_'))
      .map((f) => `examples/${f}`),
    ...readdirSync('tests/fixtures')
      .filter((f) => f.endsWith('.idf'))
      .map((f) => `tests/fixtures/${f}`),
    ...['geometry', 'schedules', 'ventilation', 'windows', 'constructions'].flatMap((d) =>
      readdirSync(`tests/fixtures/${d}`)
        .filter((f) => f.endsWith('.idf') && !withMistakes.has(f))
        .map((f) => `tests/fixtures/${d}/${f}`),
    ),
  ];

  it.each(files)('%s has no field or object errors', { timeout: 60_000 }, async (path) => {
    const list = await problems(path);
    expect(messages(list, ['Field', 'Object'])).toEqual([]);
  });
});

describe('special cases', () => {
  it('reports the required objects that are missing', async () => {
    const list = await fromText('Version,26.2;\nTimestep,4;\n');
    expect(messages(list, ['Object'])).toEqual([
      'error: The file has no Building; EnergyPlus requires one.',
      'error: The file has no GlobalGeometryRules; EnergyPlus requires one.',
    ]);
  });

  it('does not check fields without the IDD of the file version', async () => {
    const list = await fromText('Version,7.2;\nTimestep,4.5;\n');
    expect(messages(list, ['Field', 'Object'])).toEqual([
      'info: Field values are not checked: there is no IDD for EnergyPlus 7.2.',
    ]);
  });
});
