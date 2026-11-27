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
  async calendar() {
    return current().calendarView();
  },
  async scheduleList() {
    return current().scheduleList();
  },
  async scheduleDetail(name) {
    const detail = current().scheduleDetail(name);
    return detail?.values ? transfer(detail, [detail.values.buffer as ArrayBuffer]) : detail;
  },
  async dayProfiles(name, day) {
    return current().dayProfiles(name, day);
  },
  async zoneSchedules(zone) {
    return current().zoneSchedules(zone);
  },
  async zoneTable() {
    return current().zoneTable();
  },
  async zoneLoads(zone, discountLost) {
    const view = current().zoneLoads(zone, discountLost);
    const buffers = [view.people.buffer, ...Object.values(view.watts).map((a) => a.buffer)];
    return transfer(view, buffers as ArrayBuffer[]);
  },
  async occupancy() {
    const report = current().occupancy();
    return transfer(report, [report.building.buffer as ArrayBuffer]);
  },
  async windows() {
    return current().windows();
  },
  async afnOverview() {
    return current().afnOverview();
  },
  async afnCard(surface) {
    const card = current().afnCard(surface);
    const openable = card?.availability?.openable;
    return card && openable ? transfer(card, [openable.buffer as ArrayBuffer]) : card;
  },
  async zoneFlows() {
    return current().zoneFlows();
  },
  async wind() {
    return current().wind();
  },
  async network() {
    return current().network();
  },
  async constructions() {
    return current().constructions();
  },
  async siteView() {
    return current().siteView();
  },
  async outputs() {
    return current().outputs();
  },
  async textView() {
    const view = current().textView();
    return transfer(view, [view.starts.buffer, view.ends.buffer] as ArrayBuffer[]);
  },
};

expose(api);
