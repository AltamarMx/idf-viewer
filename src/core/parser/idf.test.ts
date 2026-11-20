import { describe, expect, it } from 'vitest';
import { decodeIdf, parseIdf } from './idf';

describe('parseIdf', () => {
  it('reads objects, fields and comments', () => {
    const { objects, warnings } = parseIdf(
      [
        '! A comment line',
        '  Version,26.2;',
        '',
        '  Zone,',
        '    West Zone,               !- Name',
        '    0,                       !- Direction of Relative North {deg}',
        '    ,                        !- X Origin {m}',
        '    1;                       !- Multiplier',
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({ id: 0, className: 'Version', fields: ['26.2'], line: 2 });
    expect(objects[1]).toMatchObject({
      id: 1,
      className: 'Zone',
      fields: ['West Zone', '0', '', '1'],
      line: 4,
      fieldLines: [5, 6, 7, 8],
    });
  });

  it('handles several objects per line and objects without fields', () => {
    const { objects } = parseIdf('Lead Input; Output:Surfaces:Drawing, DXF; Timestep,4;');
    expect(objects.map((o) => [o.className, o.fields])).toEqual([
      ['Lead Input', []],
      ['Output:Surfaces:Drawing', ['DXF']],
      ['Timestep', ['4']],
    ]);
  });

  it('keeps extensible vertices and ignores "!-" comments', () => {
    const { objects } = parseIdf(
      `BuildingSurface:Detailed,
  Wall 1,                  !- Name
  Wall,                    !- Surface Type
  4,                       !- Number of Vertices
  0,0,3,  !- X,Y,Z ==> Vertex 1 {m}
  0,0,0,  !- X,Y,Z ==> Vertex 2 {m}
  10,0,0, !- X,Y,Z ==> Vertex 3 {m}
  10,0,3; !- X,Y,Z ==> Vertex 4 {m}`,
    );
    expect(objects[0]?.fields).toHaveLength(15);
    expect(objects[0]?.fields.slice(3, 6)).toEqual(['0', '0', '3']);
    expect(objects[0]?.fieldLines[14]).toBe(8);
  });

  it('accepts Windows and old Mac line endings', () => {
    const { objects } = parseIdf('Version,\r\n 9.0;\r\rTimestep,\r 6;');
    expect(objects[0]).toMatchObject({ fields: ['9.0'], fieldLines: [2] });
    expect(objects[1]).toMatchObject({ className: 'Timestep', line: 4, fields: ['6'] });
  });

  it('warns about a missing final semicolon and keeps the object', () => {
    const { objects, warnings } = parseIdf('Zone,\n  Z1,\n  0');
    expect(objects[0]?.fields).toEqual(['Z1', '0']);
    expect(warnings[0]?.message).toMatch(/not terminated/);
  });

  it('warns about EP-Macro directives without parsing them', () => {
    const { objects, warnings } = parseIdf('##include Common.imf\nVersion,9.0;');
    expect(objects).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/EP-Macro/);
  });

  it('reports progress', () => {
    const fractions: number[] = [];
    parseIdf('Version,9.0;\n'.repeat(12000), (f) => fractions.push(f));
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
  });
});

describe('decodeIdf', () => {
  it('reads UTF-8', () => {
    const bytes = new TextEncoder().encode('Zone,Sala Comedor 2°;');
    expect(decodeIdf(bytes)).toEqual({ text: 'Zone,Sala Comedor 2°;', encoding: 'utf-8' });
  });

  it('falls back to Windows-1252 for files saved by IDF Editor', () => {
    // "Recámara" with á = 0xE1 in Windows-1252
    const bytes = new Uint8Array([0x52, 0x65, 0x63, 0xe1, 0x6d, 0x61, 0x72, 0x61]);
    expect(decodeIdf(bytes)).toEqual({ text: 'Recámara', encoding: 'windows-1252' });
  });

  it('drops the UTF-8 byte order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Version,9.0;')]);
    expect(decodeIdf(bytes).text).toBe('Version,9.0;');
  });
});
