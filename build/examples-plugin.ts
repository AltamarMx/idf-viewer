/**
 * Vite plugin for the example gallery (A7).
 *
 * Every .idf / .epJSON file in `examples/` becomes part of the site, together with
 * `examples/index.json`, a list generated from the files themselves. The optional
 * `examples/examples.json` gives a nicer title and a description per file:
 *
 *   { "MyHouse.idf": { "title": "My house", "description": "Two-storey house with AFN" } }
 *
 * In development the files are served straight from disk, so adding a file only
 * needs a page reload.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export interface ExampleEntry {
  file: string;
  title: string;
  description?: string;
  size: number;
  version?: string;
}

const EXAMPLE_FILE = /\.(idf|epjson)$/i;
const EXTRA_FILES = ['LICENSE-EnergyPlus.txt'];

/** Reads the Version object without a full parse: "Version, 26.2;" or "Version,\n  9.0.1;  !- ..." */
export function sniffVersion(text: string): string | undefined {
  const withoutComments = text.replace(/!.*$/gm, '');
  const match = /(?:^|;)\s*Version\s*,\s*([0-9][0-9.]*)\s*;/im.exec(withoutComments);
  if (match?.[1]) return match[1];
  const json = /"Version"\s*:\s*\{[^}]*"version_identifier"\s*:\s*"([0-9.]+)"/.exec(text);
  return json?.[1];
}

export function listExamples(dir: string): ExampleEntry[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => EXAMPLE_FILE.test(name));
  } catch {
    return [];
  }
  let meta: Record<string, { title?: string; description?: string }> = {};
  try {
    meta = JSON.parse(readFileSync(join(dir, 'examples.json'), 'utf8'));
  } catch {
    // examples.json is optional.
  }
  return files
    .map((file) => {
      const path = join(dir, file);
      const head = readFileSync(path).subarray(0, 200_000).toString('latin1');
      const info = meta[file] ?? {};
      return {
        file,
        title: info.title ?? file.replace(EXAMPLE_FILE, '').replace(/_/g, ' '),
        description: info.description,
        size: statSync(path).size,
        version: sniffVersion(head),
      };
    })
    .sort((a, b) => a.size - b.size);
}

export function examplesPlugin(dirName = 'examples'): Plugin {
  let config: ResolvedConfig;
  let dir: string;
  return {
    name: 'idf-viewer-examples',
    configResolved(resolved) {
      config = resolved;
      dir = resolve(config.root, dirName);
    },
    configureServer(server) {
      const prefix = `${config.base}${dirName}/`;
      server.middlewares.use((req, res, next) => {
        const url = req.url ? decodeURIComponent(req.url.split('?')[0] ?? '') : '';
        if (!url.startsWith(prefix)) return next();
        const name = url.slice(prefix.length);
        if (name === 'index.json') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(listExamples(dir)));
          return;
        }
        if (name.includes('/') || name.includes('..')) return next();
        if (!EXAMPLE_FILE.test(name) && !EXTRA_FILES.includes(name)) return next();
        try {
          const data = readFileSync(join(dir, name));
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(data);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      const examples = listExamples(dir);
      for (const example of examples) {
        this.emitFile({
          type: 'asset',
          fileName: `${dirName}/${example.file}`,
          source: readFileSync(join(dir, example.file)),
        });
      }
      for (const extra of EXTRA_FILES) {
        try {
          this.emitFile({
            type: 'asset',
            fileName: `${dirName}/${extra}`,
            source: readFileSync(join(dir, extra)),
          });
        } catch {
          // optional
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: `${dirName}/index.json`,
        source: JSON.stringify(examples, null, 2),
      });
    },
  };
}
