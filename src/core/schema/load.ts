import type { Schema, SchemaDocs, SchemaIndex } from './types';

/**
 * Downloads schemas from `<base>schemas/`. Each version is fetched once and kept
 * in memory; the browser cache handles later visits.
 */
export class SchemaLoader {
  private index: Promise<SchemaIndex> | null = null;
  private schemas = new Map<string, Promise<Schema>>();
  private docsCache = new Map<string, Promise<SchemaDocs>>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  availableVersions(): Promise<string[]> {
    this.index ??= this.getJson<SchemaIndex>('schemas/index.json');
    return this.index.then((i) => i.versions);
  }

  schema(version: string): Promise<Schema> {
    let pending = this.schemas.get(version);
    if (!pending) {
      pending = this.getJson<Schema>(`schemas/${version}.json`);
      this.schemas.set(version, pending);
      pending.catch(() => this.schemas.delete(version));
    }
    return pending;
  }

  /** Long help texts (\\memo and \\note), downloaded only when field help is shown. */
  docs(version: string): Promise<SchemaDocs> {
    let pending = this.docsCache.get(version);
    if (!pending) {
      pending = this.getJson<SchemaDocs>(`schemas/${version}.docs.json`);
      this.docsCache.set(version, pending);
      pending.catch(() => this.docsCache.delete(version));
    }
    return pending;
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`);
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
    return (await response.json()) as T;
  }
}
