import { proxy, transfer, wrap } from 'comlink';
import type { FileSource, LoadProgress } from '../core/session';
import type { WorkerApi } from './api';

const worker = new Worker(new URL('./idf.worker.ts', import.meta.url), { type: 'module' });
const api = wrap<WorkerApi>(worker);

export function openInWorker(source: FileSource, onProgress: (p: LoadProgress) => void) {
  const progress = proxy(onProgress);
  const payload = source.buffer ? transfer(source, [source.buffer]) : source;
  return api.open(payload, progress);
}

export function classObjects(classKey: string, offset: number, limit: number) {
  return api.classObjects(classKey, offset, limit);
}
