import type { AppConfig } from '../../config.js';
import { addDaysIso, formatHttpDate, nowIso } from '../../shared/dates.js';
import type { CalendarRecord } from '../../shared/types.js';
import type { EventRepository } from '../events/event.repository.js';
import { serializeEvents } from './ical.serializer.js';

export interface CalendarResponse {
  body: string;
  etag: string;
  lastModified: string;
  revision: number;
}

export class IcalFeedService {
  constructor(
    private readonly config: AppConfig,
    private readonly eventRepo: EventRepository,
  ) {}

  async getCalendar(calendar: CalendarRecord): Promise<CalendarResponse> {
    const retentionDays = this.config.cancelledFeedRetentionDays;
    const cutoff = addDaysIso(nowIso(), -retentionDays);

    const confirmed = await this.eventRepo.findConfirmedForCalendar(calendar.id);
    const cancelled = await this.eventRepo.findCancelledForCalendarSince(calendar.id, cutoff);
    const events = [...confirmed, ...cancelled];

    const dtStamp = calendar.lastChangedAt ?? calendar.lastSyncedAt ?? calendar.createdAt;
    const body = serializeEvents(events, { dtStamp });
    const etag = `"feed-${calendar.revision}"`;
    const lastModified = formatHttpDate(
      calendar.lastChangedAt ?? calendar.lastSyncedAt ?? calendar.updatedAt,
    );

    return {
      body,
      etag,
      lastModified,
      revision: calendar.revision,
    };
  }
}
