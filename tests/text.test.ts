/**
 * Text view (B6): the file as written and the lines of each object.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { openFile } from '../src/core/session';
import { diskSchemaLoader, fileBuffer } from './helpers';

it('keeps the text and the first and last line of each object', async () => {
  const path = 'examples/1ZoneUncontrolled.idf';
  const session = await openFile({ name: path, buffer: fileBuffer(path) }, diskSchemaLoader());
  const view = session.textView();
  expect(view.text).toBe(readFileSync(path, 'utf-8'));
  const lines = view.text.split(/\r\n|\n|\r/);
  session.model.objects.forEach((obj) => {
    const start = view.starts[obj.id] as number;
    const end = view.ends[obj.id] as number;
    expect(lines[start - 1]).toContain(obj.className);
    expect(end).toBeGreaterThanOrEqual(start);
    // The object ends with ";" on its last line (before any comment).
    expect((lines[end - 1] ?? '').split('!')[0]).toContain(';');
  });
});
