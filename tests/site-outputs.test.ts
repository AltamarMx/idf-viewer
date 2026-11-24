/**
 * Site location and design days (D5) and requested outputs (D6).
 */
import { describe, expect, it } from 'vitest';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();
const open = (path: string) => openFile({ name: path, buffer: fileBuffer(path) }, loader);
const v = (f?: { value: string; defaulted?: boolean }) =>
  f ? `${f.value}${f.defaulted ? ' (default)' : ''}` : undefined;

describe('ASHRAE901_ApartmentHighRise_STD2019_Denver', () => {
  const ready = open('examples/ASHRAE901_ApartmentHighRise_STD2019_Denver.idf');

  it('reads the location and the design days with their solar model', async () => {
    const site = (await ready).siteView();
    expect(site.location).toMatchObject({ latitude: 39.72, longitude: -104.75, timeZone: -7 });
    expect(site.notes).toEqual([]);
    const [heating, cooling] = site.designDays;
    expect(heating).toMatchObject({ month: 12, day: 21 });
    expect(v(heating?.dayType)).toBe('WinterDesignDay');
    expect(v(heating?.maxDryBulb)).toBe('-17.9');
    expect(v(cooling?.solarModel)).toBe('ASHRAETau');
    // ASHRAETau: the two optical depths.
    expect(cooling?.solar.map((f) => [f.label.slice(0, 40), f.value])).toEqual([
      ['ASHRAE Clear Sky Optical Depth for Beam ', '0.423'],
      ['ASHRAE Clear Sky Optical Depth for Diffu', '2.020'],
    ]);
    expect(v(cooling?.humidityType)).toBe('Wetbulb');
    expect(cooling?.humidity?.label).toBe('Wetbulb or DewPoint at Maximum Dry-Bulb');
  });

  it('lists run periods, holidays and daylight saving time', async () => {
    const site = (await ready).siteView();
    expect(site.runPeriods.map((r) => r.name)).toEqual([
      'RUNPERIOD 1',
      'RUNPERIOD 2',
      'RUNPERIOD 3',
    ]);
    expect(site.specialDays).toHaveLength(10);
    expect(site.daylightSaving).toMatchObject({
      start: '2nd Sunday in March',
      end: '1st Sunday in November',
    });
  });

  it('lists meters, summary reports, monthly tables and other settings', async () => {
    const out = (await ready).outputs();
    expect(out.variables).toEqual([]);
    expect(out.meters).toHaveLength(5);
    expect(out.byFrequency).toEqual([{ frequency: 'Hourly', variables: 0, meters: 5 }]);
    expect(out.summaryReports[0]?.reports).toEqual(['AllSummaryAndMonthly']);
    expect(out.monthly).toHaveLength(9);
    expect(out.monthly[0]?.items.length).toBeGreaterThan(0);
    expect(out.other.map((o) => o.className)).toContain('OutputControl:Table:Style');
  });
});

describe('5ZoneAirCooledWithSpaces', () => {
  it('counts variables and meters by frequency, in IDD order', async () => {
    const out = (await open('examples/5ZoneAirCooledWithSpaces.idf')).outputs();
    expect(out.byFrequency).toEqual([
      { frequency: 'Hourly', variables: 26, meters: 0 },
      { frequency: 'Monthly', variables: 0, meters: 10 },
      { frequency: 'RunPeriod', variables: 0, meters: 10 },
    ]);
    expect(out.summaryReports[0]?.reports).toEqual(['AllSummary', 'ZoneComponentLoadSummary']);
  });
});

describe('8.2 field names', () => {
  it('reads meters by "Name" and design days', async () => {
    const session = await open('tests/fixtures/1ZoneUncontrolled-8.2.idf');
    const out = session.outputs();
    expect(out.meters.length).toBe(3);
    expect(out.meters.every((m) => m.name !== '')).toBe(true);
    const site = session.siteView();
    expect(site.designDays.map((d) => v(d.dayType))).toEqual([
      'WinterDesignDay',
      'SummerDesignDay',
    ]);
    // The 8.2 run period has no name.
    expect(site.runPeriods).toHaveLength(1);
  });
});

describe('time zone check', () => {
  it('warns when the time zone and the longitude disagree', async () => {
    const session = await openFile(
      {
        name: 'text.idf',
        text: 'Version,26.2;\nSite:Location,Somewhere,39.7,104.9,-7,1600;\n',
      },
      loader,
    );
    expect(session.siteView().notes[0]?.text).toContain('Check their signs');
  });
});
