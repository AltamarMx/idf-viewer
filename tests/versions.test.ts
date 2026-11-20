/**
 * Phase 0 acceptance: files of versions 8.x, 9.x and 26.2 open with the field
 * names of their own version.
 */
import { describe, expect, it } from 'vitest';
import { fieldName } from '../src/core/schema/fields';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

const loader = diskSchemaLoader();

async function open(path: string) {
  return openFile({ name: path, buffer: fileBuffer(path) }, loader);
}

describe.each([
  ['tests/fixtures/1ZoneUncontrolled-8.2.idf', '8.2', 10],
  ['tests/fixtures/1ZoneUncontrolled-8.9.idf', '8.9', 10],
  ['tests/fixtures/1ZoneUncontrolled-9.0.idf', '9.0', 10],
  ['examples/1ZoneUncontrolled.idf', '26.2', 11],
])('%s', (path, version, firstVertexIndex) => {
  it(`uses the ${version} schema`, async () => {
    const session = await open(path);
    expect(session.summary.resolution).toMatchObject({ kind: 'exact', schemaVersion: version });
    expect(session.summary.warnings).toEqual([]);
    expect(session.summary.classes.every((c) => c.known)).toBe(true);
  });

  it('names the surface fields of its version', async () => {
    const session = await open(path);
    const cls = session.schema?.classes['buildingsurface:detailed'];
    expect(fieldName(cls, firstVertexIndex)).toBe('Vertex 1 X-coordinate');
    expect(fieldName(cls, firstVertexIndex + 11)).toBe('Vertex 4 Z-coordinate');
    // "Space Name" only exists from 9.6 on.
    expect(fieldName(cls, 4)).toBe(
      version === '26.2' ? 'Space Name' : 'Outside Boundary Condition',
    );

    const { objects } = session.classObjects('BuildingSurface:Detailed', 0, 1);
    const vertex = objects[0]?.fields[firstVertexIndex];
    expect(vertex).toMatchObject({ name: 'Vertex 1 X-coordinate', units: 'm' });
  });
});

describe('examples gallery', () => {
  it('opens every example with its exact schema and no unknown classes', async () => {
    const { listExamples } = await import('../build/examples-plugin');
    const examples = listExamples('examples');
    expect(examples.length).toBeGreaterThanOrEqual(8);
    for (const example of examples) {
      const session = await open(`examples/${example.file}`);
      expect(session.summary.resolution.kind, example.file).toBe('exact');
      const unknown = session.summary.classes.filter((c) => !c.known).map((c) => c.name);
      expect(unknown, example.file).toEqual([]);
      expect(session.summary.objectCount).toBeGreaterThan(0);
    }
  });
});
