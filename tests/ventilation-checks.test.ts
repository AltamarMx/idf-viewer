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
    has('error', /ΔT upper limit \(5\) must be greater than the lower limit \(10\)/);
    has('error', /"Ghost Surface" is not defined/);
    has('warning', /Infil In AFN Zone applies to ZONE ONE, which is in the AirflowNetwork/);
    has('info', /Win:Triangle is not a rectangle/);
    has('info', /EMS sets the opening factor of Win:East/);
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
