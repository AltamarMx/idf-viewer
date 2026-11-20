/// <reference lib="webworker" />
import { expose } from 'comlink';
import { SchemaLoader } from '../core/schema/load';
import { openFile, type Session } from '../core/session';
import type { WorkerApi } from './api';

const loader = new SchemaLoader(new URL(import.meta.env.BASE_URL, self.location.origin).href);
let session: Session | null = null;

const api: WorkerApi = {
  async open(source, onProgress) {
    session = null;
    session = await openFile(source, loader, onProgress);
    return session.summary;
  },
  async classObjects(classKey, offset, limit) {
    if (!session) throw new Error('No file is open.');
    return session.classObjects(classKey, offset, limit);
  },
};

expose(api);
