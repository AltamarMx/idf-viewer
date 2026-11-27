/**
 * Ventilation checks of the problems panel (L12), with mistakes made on purpose.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const loader = diskSchemaLoader();
const problems = async (path: string) =>
  (await openFile({ name: path, buffer: fileBuffer(path) }, loader))
    .problems()
    .filter((p) => p.category === 'Ventilation' || p.category === 'Reference');

describe('AfnErrors.idf', () => {
  it('finds every mistake made on purpose', async () => {
    const list = await problems('tests/fixtures/ventilation/AfnErrors.idf');
    const has = (severity: string, pattern: RegExp) =>
      expect(
        list.some((p) => p.severity === severity && pattern.test(p.message)),
        `${severity}: ${pattern}`,
      ).toBe(true);
    has('error', /ZONE ONE has AirflowNetwork surfaces but no AirflowNetwork:MultiZone:Zone/);
    has('error', /Win:East is exterior and Cp are Input, but it has no External Node Name/);
    has('error', /BadSets: Opening Factor 1 must be 0/);
    has('error', /BadSets: the last opening factor must be 1/);
    has('error', /BadSets: discharge coefficient 1\.3/);
    has(
      'warning',
      /ΔT upper limit \(5\) is not greater than the lower limit \(10\); EnergyPlus resets it to 100/,
    );
    has('error', /"Ghost Surface" is not defined/);
    has('warning', /Infil In AFN Zone applies to ZONE ONE, which is in the AirflowNetwork/);
    has('info', /Win:Triangle is not a rectangle/);
    has('info', /EMS sets the opening factor of Win:East/);
    has('error', /Skylight is exposed to outdoors: a HorizontalOpening must be between two zones/);
    // Win:South has its external node.
    expect(list.some((p) => /Win:South is exterior/.test(p.message))).toBe(false);
    // Each problem points to a line of the file.
    expect(list.every((p) => p.line !== undefined && p.objectId !== undefined)).toBe(true);
  });
});

describe('files without mistakes', () => {
  it.each([
    'examples/AirflowNetwork_MultiZone_SmallOffice.idf',
    'examples/AirflowNetwork_MultiZone_House.idf',
    'examples/ASHRAE901_ApartmentHighRise_STD2019_Denver.idf',
    'tests/fixtures/windows/Windows.idf',
    'tests/fixtures/ventilation/Wind.idf',
    'tests/fixtures/ventilation/Flows.idf',
  ])('%s has no ventilation problems', async (path) => {
    expect((await problems(path)).filter((p) => p.category === 'Ventilation')).toEqual([]);
  });

  it('notes AirflowNetwork surfaces that EnergyPlus will not use', async () => {
    const text = readFileSync(resolve(ROOT, 'tests/fixtures/windows/Windows.idf'), 'utf8').replace(
      'MultizoneWithoutDistribution,',
      'NoMultizoneOrDistribution,',
    );
    const session = await openFile({ name: 'NoMultizone.idf', text }, loader);
    const notes = session.problems().filter((p) => p.category === 'Ventilation');
    expect(notes.map((p) => [p.severity, p.message])).toEqual([
      [
        'info',
        'AirflowNetwork Control is NoMultizoneOrDistribution: the 6 AirflowNetwork surfaces have no effect.',
      ],
    ]);
  });
});

/**
 * Rules EnergyPlus 26.2 checks when it reads the network: each case below made
 * EnergyPlus stop with a severe error, or gave the warning noted.
 */
describe('rules EnergyPlus checks in the network', () => {
  const windows = readFileSync(resolve(ROOT, 'tests/fixtures/windows/Windows.idf'), 'utf8');
  const network = readFileSync(resolve(ROOT, 'tests/fixtures/ventilation/Network.idf'), 'utf8');
  const ventilation = async (text: string) =>
    (await openFile({ name: 'Variant.idf', text }, loader))
      .problems()
      .filter((p) => p.category === 'Ventilation')
      .map((p) => [p.severity, p.message]);
  /** Windows.idf with another component on a surface. */
  const onSurface = (surface: string, component: string) =>
    windows.replace(
      new RegExp(`(    ${surface},\\s*!- Surface Name\\n)\\s*[^,]+,`),
      `$1    ${component},`,
    );

  it('allows no SimpleOpening within 10° of horizontal', async () => {
    expect(await ventilation(onSurface('Skylight', 'SlidingWindow'))).toEqual([
      [
        'error',
        'Skylight is within 10° of horizontal: EnergyPlus does not allow a SimpleOpening there.',
      ],
    ]);
  });

  it('warns about a DetailedOpening within 10° of horizontal', async () => {
    expect(await ventilation(onSurface('Skylight', 'CasementWindow'))).toEqual([
      [
        'warning',
        'Skylight is within 10° of horizontal: EnergyPlus models a DetailedOpening there poorly, with one-way airflow only.',
      ],
    ]);
  });

  it('puts openings only on windows, doors and air boundaries', async () => {
    expect(await ventilation(onSurface('Zn001:Wall001', 'SlidingWindow'))).toEqual([
      [
        'error',
        'Zn001:Wall001 is a wall: a SimpleOpening must be on a window, door, glass door or air boundary.',
      ],
    ]);
  });

  it('needs two surfaces per zone and a Fan:ZoneExhaust for an exhaust fan', async () => {
    const problems = await ventilation(network);
    expect(problems).toContainEqual([
      'error',
      'Zone 5 has no surface in the AirflowNetwork: EnergyPlus needs at least two.',
    ]);
    expect(problems).toContainEqual([
      'error',
      'Zone 3 Exhaust Fan: there is no Fan:ZoneExhaust with this name; EnergyPlus needs one for the exhaust fan component.',
    ]);
    // The hatch counts for both zones; without the crack the plenum has only it.
    const oneSurface = network
      .split(/(?<=;)/)
      .filter((o) => !/AirflowNetwork:MultiZone:Surface,\s*WALL-1PF,/.test(o))
      .join('');
    expect(await ventilation(oneSurface)).toContainEqual([
      'error',
      'PLENUM-1 has only one surface in the AirflowNetwork: EnergyPlus needs at least two.',
    ]);
  });
});

describe('window frames', () => {
  it('warns that EnergyPlus ignores the frame of a simplified Window', async () => {
    const path = 'tests/fixtures/windows/Windows.idf';
    const geometry = (await openFile({ name: path, buffer: fileBuffer(path) }, loader))
      .problems()
      .filter((p) => p.category === 'Geometry');
    expect(geometry.map((p) => p.message)).toEqual([
      'Win:West is a Window object: EnergyPlus ignores its frame (FRAME 5CM). Only FenestrationSurface:Detailed windows get a frame.',
    ]);
  });
});
