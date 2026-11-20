import type { FileSource, FileSummary, LoadProgress, ObjectView } from '../core/session';

export interface WorkerApi {
  open(source: FileSource, onProgress: (p: LoadProgress) => void): Promise<FileSummary>;
  classObjects(
    classKey: string,
    offset: number,
    limit: number,
  ): Promise<{ total: number; objects: ObjectView[] }>;
}
