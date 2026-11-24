import type { AfnCard, AfnOverview } from '../core/airflow/card';
import type { FlowNetwork } from '../core/airflow/network';
import type { WindView } from '../core/airflow/wind';
import type { ZoneFlows } from '../core/airflow/zoneflows';
import type { ConstructionRow } from '../core/constructions/constructions';
import type { OccupancyReport, ZoneRow } from '../core/loads/report';
import type { WindowInventory } from '../core/openings/windows';
import type { OutputsView } from '../core/outputs';
import type { ClassDocs } from '../core/schema/types';
import type { SearchHit } from '../core/search';
import type {
  CalendarView,
  ClassTable,
  DayProfiles,
  FileSource,
  FileSummary,
  GeometryView,
  LoadProgress,
  ObjectDetail,
  ObjectView,
  ScheduleDetail,
  ScheduleListItem,
  TextView,
  ZoneLoadView,
  ZoneScheduleEntry,
} from '../core/session';
import type { SiteView } from '../core/site';
import type { BuildingSummary } from '../core/summary';
import type { Problem } from '../core/validation/problems';

export interface WorkerApi {
  open(source: FileSource, onProgress: (p: LoadProgress) => void): Promise<FileSummary>;
  classObjects(
    classKey: string,
    offset: number,
    limit: number,
  ): Promise<{ total: number; objects: ObjectView[] }>;
  inspect(id: number): Promise<ObjectDetail | null>;
  classTable(classKey: string): Promise<ClassTable>;
  geometry(): Promise<GeometryView>;
  buildingSummary(): Promise<BuildingSummary>;
  problems(): Promise<Problem[]>;
  search(query: string, limit?: number): Promise<SearchHit[]>;
  help(classKey: string): Promise<ClassDocs | null>;
  calendar(): Promise<CalendarView>;
  scheduleList(): Promise<ScheduleListItem[]>;
  scheduleDetail(name: string): Promise<ScheduleDetail | null>;
  dayProfiles(name: string, day: number): Promise<DayProfiles>;
  zoneSchedules(zone: string): Promise<ZoneScheduleEntry[]>;
  zoneTable(): Promise<ZoneRow[]>;
  zoneLoads(zone: string | null, discountLost: boolean): Promise<ZoneLoadView>;
  occupancy(): Promise<OccupancyReport>;
  windows(): Promise<WindowInventory>;
  afnOverview(): Promise<AfnOverview>;
  afnCard(surface: string): Promise<AfnCard | null>;
  zoneFlows(): Promise<ZoneFlows>;
  wind(): Promise<WindView>;
  network(): Promise<FlowNetwork>;
  constructions(): Promise<ConstructionRow[]>;
  textView(): Promise<TextView>;
  siteView(): Promise<SiteView>;
  outputs(): Promise<OutputsView>;
}
