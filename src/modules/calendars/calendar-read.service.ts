import type { DbClient } from '../../db/client.js';
import type { DeviceRecord, SyncContext } from '../../shared/types.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { EventRepository } from '../events/event.repository.js';
import type { SyncRunRecord } from '../sync/sync.repository.js';
import { SyncRepository } from '../sync/sync.repository.js';
import { CalendarRepository } from './calendar.repository.js';

export function defaultTimetableRange(from?: string, until?: string): { from: string; until: string } {
  const rangeFrom = from ?? new Date().toISOString().slice(0, 10);
  const rangeUntil =
    until ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from: rangeFrom, until: rangeUntil };
}

export interface SyncRunSummary {
  id: string;
  deviceId: string;
  deviceName: string | null;
  status: string;
  receivedCount: number;
  insertedCount: number;
  updatedCount: number;
  removedCount: number;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export class CalendarReadService {
  private readonly eventRepo: EventRepository;
  private readonly syncRepo: SyncRepository;
  private readonly deviceRepo: DeviceRepository;
  private readonly calendarRepo: CalendarRepository;

  constructor(db: DbClient) {
    this.eventRepo = new EventRepository(db);
    this.syncRepo = new SyncRepository(db);
    this.deviceRepo = new DeviceRepository(db);
    this.calendarRepo = new CalendarRepository(db);
  }

  async getStatus(context: SyncContext) {
    const { calendar, device } = context;
    const stats = await this.calendarRepo.getEventStats(calendar.id);
    const lastStatus = (await this.calendarRepo.getLastSyncStatus(calendar.id)) ?? 'unknown';
    return {
      feed: {
        name: calendar.name,
        timezone: calendar.timezone,
        revision: calendar.revision,
      },
      sync: {
        lastSyncedAt: calendar.lastSyncedAt,
        lastChangedAt: calendar.lastChangedAt,
        lastStatus,
      },
      events: stats,
      device: {
        id: device.id,
        name: device.name,
        lastSyncedAt: device.lastSyncedAt,
      },
    };
  }

  async listTimetable(calendarId: string, from?: string, until?: string) {
    const range = defaultTimetableRange(from, until);
    const events = await this.eventRepo.listByCalendarDateRange(calendarId, range.from, range.until);
    return { events };
  }

  async listSyncRuns(
    calendarId: string,
    ownerUserId: string,
    limit = 20,
  ): Promise<{ runs: SyncRunSummary[] }> {
    const runs = await this.syncRepo.listByCalendar(calendarId, limit);
    const devices = await this.deviceRepo.listByOwner(ownerUserId);
    const nameById = new Map(devices.map((device) => [device.id, device.name]));
    return {
      runs: runs.map((run) => mapSyncRunSummary(run, nameById.get(run.deviceId) ?? null)),
    };
  }

  async listDevices(ownerUserId: string, options: { includeTimestamps?: boolean } = {}) {
    const devices = await this.deviceRepo.listByOwner(ownerUserId);
    return {
      devices: devices.map((device) => mapDeviceSummary(device, options.includeTimestamps ?? false)),
    };
  }
}

function mapSyncRunSummary(run: SyncRunRecord, deviceName: string | null): SyncRunSummary {
  return {
    id: run.id,
    deviceId: run.deviceId,
    deviceName,
    status: run.status,
    receivedCount: run.receivedCount,
    insertedCount: run.insertedCount,
    updatedCount: run.updatedCount,
    removedCount: run.removedCount,
    errorCode: run.errorCode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs:
      run.completedAt != null
        ? Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())
        : null,
  };
}

function mapDeviceSummary(device: DeviceRecord, includeTimestamps: boolean) {
  const base = {
    id: device.id,
    name: device.name,
    status: device.status,
    tokenPrefix: device.tokenPrefix,
    lastSyncedAt: device.lastSyncedAt,
  };
  if (!includeTimestamps) {
    return base;
  }
  return {
    ...base,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  };
}
