import type { DbClient } from '../../db/client.js';
import type { DeviceRecord } from '../../shared/types.js';
import { EventRepository } from '../events/event.repository.js';
import { SyncRepository } from '../sync/sync.repository.js';
import { DeviceRepository } from './device.repository.js';

export function defaultTimetableRange(from?: string, until?: string): { from: string; until: string } {
  const rangeFrom = from ?? new Date().toISOString().slice(0, 10);
  const rangeUntil =
    until ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from: rangeFrom, until: rangeUntil };
}

export class CalendarReadService {
  private readonly eventRepo: EventRepository;
  private readonly syncRepo: SyncRepository;
  private readonly deviceRepo: DeviceRepository;

  constructor(db: DbClient) {
    this.eventRepo = new EventRepository(db);
    this.syncRepo = new SyncRepository(db);
    this.deviceRepo = new DeviceRepository(db);
  }

  async listTimetable(calendarId: string, from?: string, until?: string) {
    const range = defaultTimetableRange(from, until);
    const events = await this.eventRepo.listByCalendarDateRange(calendarId, range.from, range.until);
    return { events };
  }

  async listSyncRuns(calendarId: string, limit = 20) {
    const runs = await this.syncRepo.listByCalendar(calendarId, limit);
    return { runs };
  }

  async listDevices(ownerUserId: string, options: { includeTimestamps?: boolean } = {}) {
    const devices = await this.deviceRepo.listByOwner(ownerUserId);
    return {
      devices: devices.map((device) => mapDeviceSummary(device, options.includeTimestamps ?? false)),
    };
  }
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
