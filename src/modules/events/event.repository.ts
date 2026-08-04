import type { DbClient } from '../../db/client.js';
import type { EventRecord } from '../../shared/types.js';
import type { NormalizedLesson } from '../sync/sync.schemas.js';
import { buildInsertedEvent, buildUpdatedEvent } from './event.helpers.js';

export interface EventRow {
  id: string;
  owner_user_id: string;
  calendar_id: string;
  natural_key: string;
  ical_uid: string;
  local_date: string | Date;
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
  status: 'confirmed' | 'cancelled';
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function normalizeLocalDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.includes('T') ? value.slice(0, 10) : value;
}

export function mapEventRow(row: EventRow): EventRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    calendarId: row.calendar_id,
    naturalKey: row.natural_key,
    icalUid: row.ical_uid,
    localDate: normalizeLocalDate(row.local_date),
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
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export interface CalendarEventIndex {
  aliasesBySourceKey: Map<string, string>;
  eventsById: Map<string, EventRecord>;
  eventsByNaturalKey: Map<string, EventRecord>;
}

export class EventRepository {
  constructor(private readonly db: DbClient) {}

  async loadCalendarIndex(calendarId: string): Promise<CalendarEventIndex> {
    const eventRows = await this.db.query<EventRow>(
      'SELECT * FROM events WHERE calendar_id = $1',
      [calendarId],
    );
    const aliasRows = await this.db.query<{ source_key: string; event_id: string }>(
      'SELECT source_key, event_id FROM event_aliases WHERE calendar_id = $1',
      [calendarId],
    );

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
    index: CalendarEventIndex,
    sourceKey: string,
    naturalKey: string,
  ): EventRecord | null {
    const aliasEventId = index.aliasesBySourceKey.get(sourceKey);
    if (aliasEventId) {
      return index.eventsById.get(aliasEventId) ?? null;
    }
    return index.eventsByNaturalKey.get(naturalKey) ?? null;
  }

  async findConfirmedForCalendar(calendarId: string): Promise<EventRecord[]> {
    const rows = await this.db.query<EventRow>(
      `SELECT * FROM events
       WHERE calendar_id = $1 AND active = true AND status = 'confirmed'
       ORDER BY starts_at_utc ASC, ical_uid ASC`,
      [calendarId],
    );
    return rows.map(mapEventRow);
  }

  async findCancelledForCalendarSince(calendarId: string, cutoff: string): Promise<EventRecord[]> {
    const rows = await this.db.query<EventRow>(
      `SELECT * FROM events
       WHERE calendar_id = $1 AND status = 'cancelled'
         AND deleted_at IS NOT NULL AND deleted_at >= $2
       ORDER BY starts_at_utc ASC, ical_uid ASC`,
      [calendarId, cutoff],
    );
    return rows.map(mapEventRow);
  }

  async insertEvent(input: {
    id: string;
    ownerUserId: string;
    calendarId: string;
    naturalKey: string;
    icalUid: string;
    lesson: NormalizedLesson;
    timezone: string;
    now: string;
  }): Promise<EventRecord> {
    await this.db.exec(
      `INSERT INTO events (
        id, owner_user_id, calendar_id, natural_key, ical_uid,
        local_date, period_key, course_code, title,
        starts_at_utc, ends_at_utc, timezone,
        teacher, room, description, event_type,
        content_hash, sequence, status, active,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 0, 'confirmed', true, $18, $18)`,
      [
        input.id,
        input.ownerUserId,
        input.calendarId,
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
      ],
    );
    return buildInsertedEvent(input);
  }

  async updateEvent(
    existing: EventRecord,
    lesson: NormalizedLesson,
    now: string,
  ): Promise<EventRecord> {
    await this.db.exec(
      `UPDATE events SET
        local_date = $1, period_key = $2, course_code = $3, title = $4,
        starts_at_utc = $5, ends_at_utc = $6,
        teacher = $7, room = $8, description = $9,
        content_hash = $10, sequence = sequence + 1,
        status = 'confirmed', active = true, deleted_at = NULL, updated_at = $11
       WHERE id = $12`,
      [
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
      ],
    );
    return buildUpdatedEvent(existing, lesson, now);
  }

  async upsertAlias(
    calendarId: string,
    sourceKey: string,
    eventId: string,
    now: string,
  ): Promise<void> {
    await this.db.exec(
      `INSERT INTO event_aliases (calendar_id, source_key, event_id, first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (calendar_id, source_key) DO UPDATE SET
         event_id = EXCLUDED.event_id,
         last_seen_at = EXCLUDED.last_seen_at`,
      [calendarId, sourceKey, eventId, now],
    );
  }

  async cancelEvent(eventId: string, now: string): Promise<void> {
    await this.db.exec(
      `UPDATE events SET
        active = false, status = 'cancelled', sequence = sequence + 1,
        deleted_at = $2, updated_at = $2
       WHERE id = $1`,
      [eventId, now],
    );
  }

  async listByCalendarDateRange(
    calendarId: string,
    from: string,
    until: string,
  ): Promise<Array<{
    id: string;
    localDate: string;
    periodKey: string;
    title: string;
    teacher: string | null;
    room: string | null;
    startsAtUtc: string;
    endsAtUtc: string;
    status: string;
    active: boolean;
  }>> {
    const rows = await this.db.query<EventRow>(
      `SELECT * FROM events
       WHERE calendar_id = $1 AND local_date >= $2 AND local_date <= $3
       ORDER BY starts_at_utc ASC`,
      [calendarId, from, until],
    );
    return rows.map((row) => {
      const event = mapEventRow(row);
      return {
        id: event.id,
        localDate: event.localDate,
        periodKey: event.periodKey,
        title: event.title,
        teacher: event.teacher,
        room: event.room,
        startsAtUtc: event.startsAtUtc,
        endsAtUtc: event.endsAtUtc,
        status: event.status,
        active: event.active,
      };
    });
  }
}
