import { describe, expect, it } from 'vitest';
import { parseVersion, resolveVersion } from './version';

const available = ['8.0', '8.9', '9.0', '9.6', '22.1', '26.1', '26.2'];

describe('resolveVersion', () => {
  it('uses the exact version', () => {
    expect(resolveVersion('26.2', available)).toMatchObject({
      kind: 'exact',
      schemaVersion: '26.2',
    });
    expect(resolveVersion('26.2.0', available)).toMatchObject({
      kind: 'exact',
      schemaVersion: '26.2',
    });
    expect(resolveVersion(' 8.0 ', available)).toMatchObject({
      kind: 'exact',
      schemaVersion: '8.0',
    });
  });

  it('uses the minor version for patch releases', () => {
    expect(resolveVersion('9.0.1', available)).toMatchObject({
      kind: 'minor',
      schemaVersion: '9.0',
    });
  });

  it('falls back to the nearest version with a warning', () => {
    expect(resolveVersion('27.1', available)).toMatchObject({
      kind: 'nearest',
      schemaVersion: '26.2',
    });
    expect(resolveVersion('7.2', available)).toMatchObject({
      kind: 'nearest',
      schemaVersion: '8.0',
    });
    expect(resolveVersion('9.3', available)).toMatchObject({
      kind: 'nearest',
      schemaVersion: '9.0',
    });
  });

  it('has no schema without a readable version', () => {
    expect(resolveVersion(undefined, available).kind).toBe('none');
    expect(resolveVersion('latest', available).kind).toBe('none');
  });
});

describe('parseVersion', () => {
  it('reads two to four part versions', () => {
    expect(parseVersion('8.0.0.008')).toEqual({ major: 8, minor: 0, patch: 0 });
    expect(parseVersion('9.0.1')).toEqual({ major: 9, minor: 0, patch: 1 });
    expect(parseVersion('26.2')).toEqual({ major: 26, minor: 2, patch: 0 });
  });
});
