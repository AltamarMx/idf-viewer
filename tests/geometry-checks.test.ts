/**
 * Geometry checks (C8, H5): the viewer reports the same geometry warnings as
 * EnergyPlus (tests/oracles/*.json, from eplusout.err with DisplayExtraWarnings),
 * no more and no fewer, in the examples and in tests/fixtures/geometry/Defects.idf.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIEWER_ONLY_CHECKS } from '../src/core/geometry/checks';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer, ROOT } from './helpers';

const loader = diskSchemaLoader();

const files = [
  ...readdirSync(resolve(ROOT, 'examples'))
    .filter((f) => f.endsWith('.idf'))
    .map((f) => `examples/${f}`),
  ...['geometry', 'windows', 'ventilation', 'schedules'].flatMap((dir) =>
    readdirSync(resolve(ROOT, 'tests/fixtures', dir))
      .filter((f) => f.endsWith('.idf'))
      .map((f) => `tests/fixtures/${dir}/${f}`),
  ),
]
  .map((idf) => {
    const stem = idf.replace(/^.*\//, '').replace(/\.idf$/, '');
    const path = resolve(ROOT, `tests/oracles/${stem}.json`);
    const oracle = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    return [stem, idf, oracle.geometryWarnings as [string, string][] | undefined] as const;
  })
  .filter(([, , warnings]) => warnings !== undefined);

describe('geometry checks match EnergyPlus', () => {
  it('has the Defects.idf reference', () => {
    expect(files.map(([stem]) => stem)).toContain('Defects');
  });

  it.each(files)('%s', async (_stem, idf, reference) => {
    const session = await openFile({ name: idf, buffer: fileBuffer(idf) }, loader);
    const ours = session.geometry.issues
      .filter((i) => !VIEWER_ONLY_CHECKS.has(i.check))
      .map(
        (i) =>
          `${i.check}: ${i.names
            .slice(0, i.check.startsWith('interzone') ? 2 : 1)
            .map((n) => n.toUpperCase())
            .sort()
            .join(' | ')}`,
      );
    const theirs = (reference ?? []).map(([kind, name]) => `${kind}: ${name}`);
    expect([...new Set(ours)].sort()).toEqual([...new Set(theirs)].sort());
  });
});

describe('Defects.idf', () => {
  const ready = openFile(
    { name: 'Defects.idf', buffer: fileBuffer('tests/fixtures/geometry/Defects.idf') },
    loader,
  );

  it('reports the window that is off the plane of its wall (EnergyPlus does not)', async () => {
    const issues = (await ready).geometry.issues.filter((i) => i.check === 'subsurfaceOffPlane');
    expect(issues.map((i) => i.names[0])).toEqual(['Window Off Plane']);
    expect(issues[0]?.message).toContain('0.1 m away');
  });

  it('gives severe errors as errors in the problems panel', async () => {
    const problems = (await ready).problems().filter((p) => p.category === 'Geometry');
    const errors = problems.filter((p) => p.severity === 'error').map((p) => p.message);
    expect(errors.some((m) => m.startsWith('Not Planar North is not planar'))).toBe(true);
    expect(errors.some((m) => m.startsWith('Small East Sliver has fewer than 3 vertices'))).toBe(
      true,
    );
    // Each one points to its object.
    expect(problems.every((p) => p.objectId !== undefined && p.line !== undefined)).toBe(true);
  });

  it('measures out-of-plane distance as EnergyPlus does', async () => {
    const issue = (await ready).geometry.issues.find(
      (i) => i.check === 'nonPlanarSevere' && i.names[0] === 'Not Planar South',
    );
    // EnergyPlus: Max "out of line" = 0.01250 for a corner moved 5 cm.
    expect(issue?.message).toContain('12.5 mm');
  });
});
