/**
 * Tolerant IDF reader (A2).
 *
 * The IDF syntax has not changed across EnergyPlus versions: objects end with ";",
 * fields are separated by "," and "!" starts a comment until the end of the line.
 * Values are kept exactly as written (trimmed); nothing is converted here.
 */

export interface IdfObject {
  /** Position in the file (0-based). */
  id: number;
  /** Class name as written in the file, e.g. "BuildingSurface:Detailed". */
  className: string;
  /** Field values as written, trimmed. */
  fields: string[];
  /** 1-based line where the object starts. */
  line: number;
  /** 1-based line of each field. */
  fieldLines: number[];
}

export interface ParseWarning {
  line: number;
  message: string;
}

export interface ParseResult {
  objects: IdfObject[];
  warnings: ParseWarning[];
  lineCount: number;
}

export type ProgressCallback = (fraction: number) => void;

const PROGRESS_EVERY_LINES = 5000;

export function parseIdf(text: string, onProgress?: ProgressCallback): ParseResult {
  const objects: IdfObject[] = [];
  const warnings: ParseWarning[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  const lineCount = lines.length;

  let current: IdfObject | null = null;
  let pending = '';
  let pendingLine = 0;
  let macroWarned = false;

  const take = (separatorLine: number): { value: string; line: number } => {
    const value = pending.trim();
    const line = value ? pendingLine : separatorLine;
    pending = '';
    pendingLine = 0;
    return { value, line };
  };

  const finish = () => {
    if (current) objects.push(current);
    current = null;
  };

  for (let i = 0; i < lineCount; i++) {
    const lineNumber = i + 1;
    if (onProgress && i % PROGRESS_EVERY_LINES === 0) onProgress(i / lineCount);
    const raw = lines[i] ?? '';

    // EP-Macro directives (##include, ##set1, ...) are not expanded.
    if (raw.trimStart().startsWith('##')) {
      if (!macroWarned) {
        warnings.push({
          line: lineNumber,
          message:
            'This file uses EP-Macro directives (##...). They are not expanded; objects from included files are missing.',
        });
        macroWarned = true;
      }
      continue;
    }

    const bang = raw.indexOf('!');
    const data = bang >= 0 ? raw.slice(0, bang) : raw;
    let start = 0;
    for (let j = 0; j < data.length; j++) {
      const char = data[j];
      if (char !== ',' && char !== ';') continue;
      appendPending(data.slice(start, j), lineNumber);
      start = j + 1;
      const { value, line } = take(lineNumber);

      if (current === null) {
        if (!value) {
          warnings.push({ line: lineNumber, message: `Unexpected "${char}" outside an object.` });
          continue;
        }
        current = { id: objects.length, className: value, fields: [], line, fieldLines: [] };
        if (char === ';') finish();
        continue;
      }
      const obj: IdfObject = current;
      obj.fields.push(value);
      obj.fieldLines.push(line);
      if (char === ';') finish();
    }
    appendPending(data.slice(start), lineNumber);
  }

  function appendPending(piece: string, lineNumber: number) {
    if (!piece.trim()) return;
    if (!pending.trim()) {
      pending = piece;
      pendingLine = lineNumber;
    } else {
      // A value split over two lines: keep a single space between the pieces.
      pending = `${pending.trimEnd()} ${piece.trimStart()}`;
    }
  }

  const unfinished = current as IdfObject | null;
  if (unfinished) {
    const leftover = pending.trim();
    if (leftover) {
      unfinished.fields.push(leftover);
      unfinished.fieldLines.push(pendingLine);
    }
    warnings.push({
      line: unfinished.line,
      message: `Object "${unfinished.className}" is not terminated with ";".`,
    });
    objects.push(unfinished);
  } else if (pending.trim()) {
    warnings.push({
      line: pendingLine,
      message: `Text "${pending.trim()}" is not part of any object.`,
    });
  }

  onProgress?.(1);
  return { objects, warnings, lineCount };
}

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';
}

/**
 * IDF files saved from IDF Editor with accents are usually Windows-1252, while
 * newer files are UTF-8. Try UTF-8 strictly and fall back to Windows-1252.
 */
export function decodeIdf(buffer: ArrayBuffer | Uint8Array): DecodedText {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    // TextDecoder drops the UTF-8 BOM by default.
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}
