import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SchemaLoader } from '../src/core/schema/load';

export const ROOT = resolve(import.meta.dirname, '..');

/** A SchemaLoader that reads public/schemas from disk. */
export function diskSchemaLoader(): SchemaLoader {
  return new SchemaLoader('', async (input) => {
    const path = resolve(ROOT, 'public', String(input));
    try {
      return new Response(readFileSync(path));
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

export function fileBuffer(relativePath: string): ArrayBuffer {
  const data = readFileSync(resolve(ROOT, relativePath));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
