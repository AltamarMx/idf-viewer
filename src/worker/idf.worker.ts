/// <reference lib="webworker" />
import { expose, transfer } from 'comlink';
import { SchemaLoader } from '../core/schema/load';
import { openFile, type Session } from '../core/session';
import type { WorkerApi } from './api';

const loader = new SchemaLoader(new URL(import.meta.env.BASE_URL, self.location.origin).href);
let session: Session | null = null;

function current(): Session {
  if (!session) throw new Error('No file is open.');
  return session;
}

const api: WorkerApi = {
  async open(source, onProgress) {
    session = null;
    session = await openFile(source, loader, onProgress);
    return session.summary;
  },
  async classObjects(classKey, offset, limit) {
    return current().classObjects(classKey, offset, limit);
  },
  async inspect(id) {
    return current().inspect(id);
  },
  async classTable(classKey) {
    return current().classTable(classKey);
  },
  async geometry() {
    const view = current().geometryView();
    const buffers = view.surfaces.flatMap((s) => [s.positions.buffer, s.triangles.buffer]);
    return transfer(view, buffers as ArrayBuffer[]);
  },
  async buildingSummary() {
    return current().buildingSummary();
  },
  async problems() {
    return current().problems();
  },
  async search(query, limit) {
    return current().search(query, limit);
  },
  async help(classKey) {
    return current().help(classKey);
  },
};

expose(api);
