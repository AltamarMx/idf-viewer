/**
 * epJSON reading (A5): each epJSON fixture was converted from an IDF with
 * EnergyPlus 26.2 (ConvertInputFormat) and must give the same objects and the
 * same results as its IDF.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { epJsonName, epJsonObjects, parseJson } from '../src/core/parser/epjson';
import type { IdfObject } from '../src/core/parser/idf';
import { openFile, type Session } from '../src/core/session';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const loader = diskSchemaLoader();
const open = (path: string) => openFile({ name: path, buffer: fileBuffer(path) }, loader);

describe('JSON with lines', () => {
  it('keeps the line of every key and the digits of every number', () => {
    const root = parseJson(
      '{\n  "A": {\n    "x": 0.0,\n    "y": "a\\"b\\u00e9"\n  },\n  "B": [1e-5, true, null]\n}',
    );
    expect(root.kind).toBe('object');
    if (root.kind !== 'object') return;
    expect(root.entries.map((e) => [e.key, e.line])).toEqual([
      ['A', 2],
      ['B', 6],
    ]);
    const a = root.entries[0]?.value;
    expect(a).toMatchObject({ kind: 'object', line: 2, endLine: 5 });
    if (a?.kind !== 'object') return;
    expect(a.entries[0]).toMatchObject({
      key: 'x',
      line: 3,
      value: { kind: 'number', raw: '0.0' },
    });
    expect(a.entries[1]?.value).toMatchObject({ kind: 'string', value: 'a"bé' });
  });

  it('says where the JSON is broken', () => {
    expect(() => parseJson('{\n  "A": {\n    "x": 1,\n  }\n}')).toThrow(/line 4/);
    expect(() => parseJson('{"A": 1')).toThrow(/Expected "," or "}"/);
  });
});

describe('field names', () => {
  it('follows the rule of the EnergyPlus epJSON schema', () => {
    expect(epJsonName('Direction of Relative North')).toBe('direction_of_relative_north');
    expect(epJsonName('Vertex {n} X-coordinate')).toBe('vertex_x_coordinate');
    expect(epJsonName('Window/Door Opening Factor, or Crack Factor')).toBe(
      'window_door_opening_factor_or_crack_factor',
    );
    // A closing parenthesis leaves a trailing underscore.
    expect(epJsonName('ASHRAE Clear Sky Optical Depth for Beam Irradiance (taub)')).toBe(
      'ashrae_clear_sky_optical_depth_for_beam_irradiance_taub_',
    );
    expect(epJsonName('Field {n}')).toBe('field');
  });

  /**
   * Checked against Energy+.schema.epJSON of EnergyPlus 26.2 when it is installed
   * (it is not in the repository): every field of every class.
   */
  const installed = '/Applications/EnergyPlus-26-2-0/Energy+.schema.epJSON';
  it.skipIf(!existsSync(installed))('gives every field name of the 26.2 schema', () => {
    const ep = JSON.parse(readFileSync(installed, 'utf8')).properties as Record<
      string,
      { legacy_idd: { fields: string[]; extensibles?: string[] } }
    >;
    const ours = JSON.parse(readFileSync(resolve(ROOT, 'public/schemas/26.2.json'), 'utf8'))
      .classes as Record<
      string,
      {
        name: string;
        fields: { name: string; tpl?: string }[];
        extensible?: { start: number; size: number };
      }
    >;
    const wrong: string[] = [];
    for (const cls of Object.values(ours)) {
      const legacy = ep[cls.name]?.legacy_idd;
      if (!legacy || legacy.fields.length === 0) continue; // GroundHeatTransfer:*FACE
      const start = cls.extensible?.start ?? cls.fields.length;
      const fields = cls.fields.slice(0, start).map((f) => epJsonName(f.name));
      const expected = legacy.fields.slice(0, start);
      // The object key replaces the first field (its Name).
      if (expected[0] === 'name') fields[0] = 'name';
      const group = cls.fields
        .slice(start, start + (cls.extensible?.size ?? 0))
        .map((f) => epJsonName(f.tpl ?? f.name));
      if (fields.join() !== expected.join() || group.join() !== (legacy.extensibles ?? []).join())
        wrong.push(cls.name);
    }
    expect(wrong).toEqual([]);
  });
});

describe('epJSON with mistakes', () => {
  const text = `{
    "Version": { "Version 1": { "version_identifier": "26.2" } },
    "Zone": {
      "Office": { "direction_of_relative_north": 0, "multiplier": 2, "not_a_field": 1 }
    },
    "Made:Up": { "Thing": { "a": 1, "b": "x" } }
  }`;

  it('reads what it can and says what it cannot', async () => {
    const session = await openFile({ name: 'Mistakes.epJSON', text }, loader);
    expect(session.summary.format).toBe('epjson');
    expect(session.summary.resolution).toMatchObject({ kind: 'exact', schemaVersion: '26.2' });
    const zone = session.model.ofClass('zone')[0] as IdfObject;
    expect(zone).toMatchObject({ className: 'Zone', line: 4 });
    expect(zone.fields.slice(0, 7)).toEqual(['Office', '0', '', '', '', '', '2']);
    expect(session.summary.warnings).toEqual([
      { line: 4, message: 'Zone "Office": "not_a_field" is not a field of Zone.' },
    ]);
    // An unknown class keeps its fields in the order written.
    expect(session.model.ofClass('made:up')[0]?.fields).toEqual(['Thing', '1', 'x']);
  });

  it('refuses a file that is not JSON', async () => {
    await expect(openFile({ name: 'Bad.epJSON', text: '{ "Zone": ' }, loader)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it('opens without a schema when there is no version', async () => {
    const root = parseJson('{ "Zone": { "Office": { "multiplier": 2 } } }');
    expect(epJsonObjects(root, undefined).objects[0]?.fields).toEqual(['Office', '2']);
  });
});

/** Field values compared as EnergyPlus would: numbers by value, text without case. */
const normalize = (v: string) => {
  const t = v.trim();
  if (t !== '' && Number.isFinite(Number(t))) return String(Number(t));
  const lower = t.toLowerCase();
  // The converter writes Autosize for some AUTOCALCULATE values.
  return lower === 'autocalculate' ? 'autosize' : lower;
};
const signature = (o: IdfObject) => {
  const fields = o.fields.map(normalize);
  while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();
  return `${o.className.toLowerCase()} | ${fields.join(' | ')}`;
};

const pairs = [
  ['examples/1ZoneUncontrolled.epJSON', 'examples/1ZoneUncontrolled.idf'],
  ...readdirSync(resolve(ROOT, 'tests/fixtures/epjson'))
    .filter((f) => f.endsWith('.epJSON'))
    .map((f) => {
      const stem = f.replace(/\.epJSON$/, '');
      const idf = [
        'examples',
        'tests/fixtures/windows',
        'tests/fixtures/schedules',
        'tests/fixtures/geometry',
      ]
        .map((d) => `${d}/${stem}.idf`)
        .find((p) => existsSync(resolve(ROOT, p)));
      return [`tests/fixtures/epjson/${f}`, idf as string];
    }),
];

describe.each(pairs)('%s', (epjson, idf) => {
  let a: Session;
  let b: Session;
  const both = async () => {
    a ??= await open(idf);
    b ??= await open(epjson);
    return [a, b] as const;
  };

  it('has the same objects as its IDF', async () => {
    const [fromIdf, fromJson] = await both();
    expect(fromJson.summary.warnings).toEqual([]);
    expect(fromJson.model.objects.map(signature).sort()).toEqual(
      fromIdf.model.objects.map(signature).sort(),
    );
  });

  it('gives the same geometry, schedules, loads and problems', async () => {
    const [fromIdf, fromJson] = await both();
    const surfaces = (s: Session) =>
      Object.fromEntries(s.geometryView().surfaces.map((x) => [x.name, x.area.toFixed(6)]));
    expect(surfaces(fromJson)).toEqual(surfaces(fromIdf));
    const zones = (s: Session) =>
      Object.fromEntries(
        s.geometryView().zones.map((z) => [z.name, [z.volume.toFixed(4), z.floorArea.toFixed(4)]]),
      );
    expect(zones(fromJson)).toEqual(zones(fromIdf));
    const schedules = (s: Session) =>
      Object.fromEntries(
        s.scheduleList().map((x) => [x.name, Array.from(s.scheduleDetail(x.name)?.values ?? [])]),
      );
    expect(schedules(fromJson)).toEqual(schedules(fromIdf));
    expect(Array.from(fromJson.zoneLoads(null, false).people)).toEqual(
      Array.from(fromIdf.zoneLoads(null, false).people),
    );
    const problems = (s: Session) =>
      s
        .problems()
        .map((p) => `${p.severity} ${p.message}`)
        .sort();
    expect(problems(fromJson)).toEqual(problems(fromIdf));
  });

  it('points each object and field to its line in the epJSON', async () => {
    const [, fromJson] = await both();
    const lines = readFileSync(resolve(ROOT, epjson), 'utf8').split('\n');
    const schema = fromJson.schema;
    for (const obj of fromJson.model.objects) {
      expect(lines[obj.line - 1]).toMatch(/^\s*".*":\s*\{/);
      const cls = schema?.classes[obj.className.toLowerCase()];
      obj.fields.forEach((value, i) => {
        if (value === '' || i === 0) return;
        const field =
          cls?.fields[i] ??
          cls?.fields[
            (cls.extensible?.start ?? 0) +
              ((i - (cls.extensible?.start ?? 0)) % (cls.extensible?.size ?? 1))
          ];
        if (!field) return;
        expect(lines[(obj.fieldLines[i] as number) - 1]).toContain(
          `"${epJsonName(field.tpl ?? field.name).replace(/_$/, '')}`,
        );
      });
    }
  });
});
