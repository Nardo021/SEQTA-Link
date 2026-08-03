import type { Database } from "better-sqlite3";
import type { EventRecord } from "../../shared/types.js";
import type { NormalizedLesson } from "../sync/sync.schemas.js";
import { buildInsertedEvent, buildUpdatedEvent } from "./event.helpers.js";

export interface EventRow {
  id: string;
  feed_id: string;
  natural_key: string;
  ical_uid: string;
  local_date: string;
  period_key: string;
  course_code: string | null;
  title: string;
  starts_at_utc: string;
  ends_at_utc: string;
  timezone: string;
  teacher: string | null;
  room: string | null;
  description: string | null;
  event_type: string;
  content_hash: string;
  sequence: number;
  status: "confirmed" | "cancelled";
  active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function mapEventRow(row: EventRow): EventRecord {
  return {
    id: row.id,
    feedId: row.feed_id,
    naturalKey: row.natural_key,
    icalUid: row.ical_uid,
    localDate: row.local_date,
    periodKey: row.period_key,
    courseCode: row.course_code,
    title: row.title,
    startsAtUtc: row.starts_at_utc,
    endsAtUtc: row.ends_at_utc,
    timezone: row.timezone,
    teacher: row.teacher,
    room: row.room,
    description: row.description,
    eventType: row.event_type,
    contentHash: row.content_hash,
    sequence: row.sequence,
    status: row.status,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export interface FeedEventIndex {
  aliasesBySourceKey: Map<string, string>;
  eventsById: Map<string, EventRecord>;
  eventsByNaturalKey: Map<string, EventRecord>;
}

export class EventRepository {
  constructor(private readonly db: Database) {}

  loadFeedIndex(feedId: string): FeedEventIndex {
    const eventRows = this.db
      .prepare("SELECT * FROM events WHERE feed_id = ?")
      .all(feedId) as EventRow[];

    const aliasRows = this.db
      .prepare(
        "SELECT source_key, event_id FROM event_aliases WHERE feed_id = ?",
      )
      .all(feedId) as Array<{ source_key: string; event_id: string }>;

    const eventsById = new Map<string, EventRecord>();
    const eventsByNaturalKey = new Map<string, EventRecord>();
    for (const row of eventRows) {
      const event = mapEventRow(row);
      eventsById.set(event.id, event);
      eventsByNaturalKey.set(event.naturalKey, event);
    }

    const aliasesBySourceKey = new Map<string, string>();
    for (const row of aliasRows) {
      aliasesBySourceKey.set(row.source_key, row.event_id);
    }

    return { aliasesBySourceKey, eventsById, eventsByNaturalKey };
  }

  resolveEvent(
    index: FeedEventIndex,
    sourceKey: string,
    naturalKey: string,
  ): EventRecord | null {
    const aliasEventId = index.aliasesBySourceKey.get(sourceKey);
    if (aliasEventId) {
      return index.eventsById.get(aliasEventId) ?? null;
    }
    return index.eventsByNaturalKey.get(naturalKey) ?? null;
  }

  findConfirmedForFeed(feedId: string): EventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE feed_id = ? AND active = 1 AND status = 'confirmed'
         ORDER BY starts_at_utc ASC, ical_uid ASC`,
      )
      .all(feedId) as EventRow[];
    return rows.map(mapEventRow);
  }

  findCancelledForFeedSince(feedId: string, cutoff: string): EventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM events
         WHERE feed_id = ? AND status = 'cancelled'
           AND deleted_at IS NOT NULL AND deleted_at >= ?
         ORDER BY starts_at_utc ASC, ical_uid ASC`,
      )
      .all(feedId, cutoff) as EventRow[];
    return rows.map(mapEventRow);
  }

  insertEvent(input: {
    id: string;
    feedId: string;
    naturalKey: string;
    icalUid: string;
    lesson: NormalizedLesson;
    timezone: string;
    now: string;
  }): EventRecord {
    this.db
      .prepare(
        `INSERT INTO events (
          id, feed_id, natural_key, ical_uid,
          local_date, period_key, course_code, title,
          starts_at_utc, ends_at_utc, timezone,
          teacher, room, description, event_type,
          content_hash, sequence, status, active,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'confirmed', 1, ?, ?)`,
      )
      .run(
        input.id,
        input.feedId,
        input.naturalKey,
        input.icalUid,
        input.lesson.date,
        input.lesson.periodKey,
        input.lesson.courseCode,
        input.lesson.title,
        input.lesson.startUtc,
        input.lesson.endUtc,
        input.timezone,
        input.lesson.teacher,
        input.lesson.room,
        input.lesson.description,
        input.lesson.type,
        input.lesson.contentHash,
        input.now,
        input.now,
      );

    return buildInsertedEvent(input);
  }

  updateEvent(
    existing: EventRecord,
    lesson: NormalizedLesson,
    now: string,
  ): EventRecord {
    this.db
      .prepare(
        `UPDATE events SET
          local_date = ?, period_key = ?, course_code = ?, title = ?,
          starts_at_utc = ?, ends_at_utc = ?,
          teacher = ?, room = ?, description = ?,
          content_hash = ?, sequence = sequence + 1,
          status = 'confirmed', active = 1, deleted_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        lesson.date,
        lesson.periodKey,
        lesson.courseCode,
        lesson.title,
        lesson.startUtc,
        lesson.endUtc,
        lesson.teacher,
        lesson.room,
        lesson.description,
        lesson.contentHash,
        now,
        existing.id,
      );

    return buildUpdatedEvent(existing, lesson, now);
  }

  upsertAlias(
    feedId: string,
    sourceKey: string,
    eventId: string,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO event_aliases (feed_id, source_key, event_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(feed_id, source_key) DO UPDATE SET
           event_id = excluded.event_id,
           last_seen_at = excluded.last_seen_at`,
      )
      .run(feedId, sourceKey, eventId, now, now);
  }

  cancelEvent(eventId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE events SET
          active = 0, status = 'cancelled', sequence = sequence + 1,
          deleted_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, eventId);
  }
}
