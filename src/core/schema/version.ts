/**
 * Version resolution (A3): which schema to use for a file.
 *
 * 1. exact: the file's major.minor has a schema (patch 0 or absent);
 * 2. minor: a patch release (e.g. 9.0.1) uses its minor version's schema (9.0);
 * 3. nearest: otherwise the closest available version, with a warning;
 * 4. none: the file has no readable Version object; fields show as "Field N".
 */

export interface VersionNumber {
  major: number;
  minor: number;
  patch: number;
}

export type Resolution =
  | { kind: 'exact' | 'minor'; fileVersion: string; schemaVersion: string; message?: string }
  | { kind: 'nearest'; fileVersion: string; schemaVersion: string; message: string }
  | { kind: 'none'; fileVersion?: string; message: string };

export function parseVersion(text: string | undefined): VersionNumber | null {
  const match = /^\s*(\d+)\.(\d+)(?:\.(\d+))?/.exec(text ?? '');
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : 0,
  };
}

const rank = (v: VersionNumber) => v.major * 100 + v.minor;

export function resolveVersion(fileVersion: string | undefined, available: string[]): Resolution {
  const parsed = parseVersion(fileVersion);
  if (!fileVersion || !parsed) {
    return {
      kind: 'none',
      fileVersion,
      message: fileVersion
        ? `Version "${fileVersion}" is not readable. Fields are shown without names.`
        : 'The file has no Version object. Fields are shown without names.',
    };
  }
  const candidates = available
    .map((v) => ({ text: v, number: parseVersion(v) }))
    .filter((v): v is { text: string; number: VersionNumber } => v.number !== null);
  if (candidates.length === 0) {
    return { kind: 'none', fileVersion, message: 'No schemas are available.' };
  }

  const same = candidates.find(
    (c) => c.number.major === parsed.major && c.number.minor === parsed.minor,
  );
  if (same) {
    if (parsed.patch === 0) return { kind: 'exact', fileVersion, schemaVersion: same.text };
    return {
      kind: 'minor',
      fileVersion,
      schemaVersion: same.text,
      message: `Using the ${same.text} schema for version ${fileVersion}.`,
    };
  }

  let best = candidates[0] as { text: string; number: VersionNumber };
  for (const c of candidates) {
    const d = Math.abs(rank(c.number) - rank(parsed));
    const bestD = Math.abs(rank(best.number) - rank(parsed));
    // On a tie prefer the older version.
    if (d < bestD || (d === bestD && rank(c.number) < rank(best.number))) best = c;
  }
  return {
    kind: 'nearest',
    fileVersion,
    schemaVersion: best.text,
    message: `There is no schema for EnergyPlus ${fileVersion}; using ${best.text}. Some field names may be wrong.`,
  };
}
