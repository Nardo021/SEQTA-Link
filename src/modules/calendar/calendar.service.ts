import type { AppConfig } from "../../config.js";
import { addDaysIso, formatHttpDate, nowIso } from "../../shared/dates.js";
import type { FeedRecord } from "../../shared/types.js";
import type { EventRepository } from "../events/event.repository.js";
import { serializeEvents } from "./ical.serializer.js";

export interface CalendarResponse {
  body: string;
  etag: string;
  lastModified: string;
  revision: number;
}

export class CalendarService {
  constructor(
    private readonly config: AppConfig,
    private readonly eventRepo: EventRepository,
  ) {}

  getCalendar(feed: FeedRecord): CalendarResponse {
    const retentionDays = this.config.cancelledFeedRetentionDays;
    const cutoff = addDaysIso(nowIso(), -retentionDays);

    const confirmed = this.eventRepo.findConfirmedForFeed(feed.id);
    const cancelled = this.eventRepo.findCancelledForFeedSince(feed.id, cutoff);
    const events = [...confirmed, ...cancelled];

    const dtStamp = feed.lastChangedAt ?? feed.lastSyncedAt ?? feed.createdAt;
    const body = serializeEvents(events, { dtStamp });
    const etag = `"feed-${feed.revision}"`;
    const lastModified = formatHttpDate(
      feed.lastChangedAt ?? feed.lastSyncedAt ?? feed.updatedAt,
    );

    return {
      body,
      etag,
      lastModified,
      revision: feed.revision,
    };
  }
}
