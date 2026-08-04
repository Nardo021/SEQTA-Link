import type { DbClient } from '../../db/client.js';
import type { CalendarRecord } from '../../shared/types.js';

interface CalendarRow {
  id: string;
  owner_user_id: string;
  name: string;
  timezone: string;
  revision: string;
  last_synced_at: string | null;
  last_changed_at: string | null;
  created_at: string;
  updated_at: string;
  school_host: string | null;
  student_ref: string | null;
}

function mapCalendarRow(row: CalendarRow): CalendarRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    timezone: row.timezone,
    schoolHost: row.school_host ?? '',
    studentRef: row.student_ref ?? '',
    revision: Number(row.revision),
    lastSyncedAt: row.last_synced_at,
    lastChangedAt: row.last_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CALENDAR_SELECT = `
  SELECT c.id, c.owner_user_id, c.name, c.timezone, c.revision,
         c.last_synced_at, c.last_changed_at, c.created_at, c.updated_at,
         si.school_host, si.student_ref
  FROM calendars c
  LEFT JOIN source_identities si ON si.calendar_id = c.id
`;

export class CalendarRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<CalendarRecord | null> {
    const row = await this.db.queryOne<CalendarRow>(`${CALENDAR_SELECT} WHERE c.id = $1`, [id]);
    return row ? mapCalendarRow(row) : null;
  }

  async findByOwnerUserId(ownerUserId: string): Promise<CalendarRecord | null> {
    const row = await this.db.queryOne<CalendarRow>(
      `${CALENDAR_SELECT} WHERE c.owner_user_id = $1`,
      [ownerUserId],
    );
    return row ? mapCalendarRow(row) : null;
  }

  async findByCalendarTokenHash(hash: string): Promise<CalendarRecord | null> {
    const row = await this.db.queryOne<CalendarRow>(
      `${CALENDAR_SELECT}
       JOIN calendar_tokens ct ON ct.calendar_id = c.id
       WHERE ct.token_hash = $1 AND ct.status = 'active'`,
      [hash],
    );
    return row ? mapCalendarRow(row) : null;
  }

  async createCalendar(input: {
    id: string;
    ownerUserId: string;
    name: string;
    timezone: string;
    schoolHost?: string;
    studentRef?: string;
    calendarTokenHash: string;
    calendarTokenPrefix: string;
    now: string;
  }): Promise<CalendarRecord> {
    await this.db.exec(
      `INSERT INTO calendars (id, owner_user_id, name, timezone, revision, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, $5, $5)`,
      [input.id, input.ownerUserId, input.name, input.timezone, input.now],
    );
    if (input.schoolHost && input.studentRef) {
      await this.db.exec(
        `INSERT INTO source_identities (calendar_id, school_host, student_ref, locked_at)
         VALUES ($1, $2, $3, $4)`,
        [input.id, input.schoolHost, input.studentRef, input.now],
      );
    }
    await this.db.exec(
      `INSERT INTO calendar_tokens (calendar_id, token_hash, token_prefix, status, created_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [input.id, input.calendarTokenHash, input.calendarTokenPrefix, input.now],
    );
    const calendar = await this.findById(input.id);
    if (!calendar) {
      throw new Error('Failed to create calendar');
    }
    return calendar;
  }

  async incrementRevision(calendarId: string, now: string): Promise<number> {
    const row = await this.db.queryOne<{ revision: string }>(
      `UPDATE calendars
       SET revision = revision + 1, last_changed_at = $2, updated_at = $2
       WHERE id = $1
       RETURNING revision`,
      [calendarId, now],
    );
    return Number(row!.revision);
  }

  async updateLastSynced(calendarId: string, now: string): Promise<void> {
    await this.db.exec(
      'UPDATE calendars SET last_synced_at = $2, updated_at = $2 WHERE id = $1',
      [calendarId, now],
    );
  }

  async updateCalendarToken(
    calendarId: string,
    hash: string,
    prefix: string,
    now: string,
  ): Promise<void> {
    await this.db.exec(
      `UPDATE calendar_tokens SET status = 'revoked', revoked_at = $2
       WHERE calendar_id = $1 AND status = 'active'`,
      [calendarId, now],
    );
    await this.db.exec(
      `INSERT INTO calendar_tokens (calendar_id, token_hash, token_prefix, status, created_at)
       VALUES ($1, $2, $3, 'active', $4)`,
      [calendarId, hash, prefix, now],
    );
    await this.db.exec('UPDATE calendars SET updated_at = $2 WHERE id = $1', [calendarId, now]);
  }

  async getEventStats(calendarId: string): Promise<{
    active: number;
    cancelled: number;
    nextEventAt: string | null;
  }> {
    const activeRow = await this.db.queryOne<{ count: string | number }>(
      `SELECT COUNT(*) AS count FROM events
       WHERE calendar_id = $1 AND active = true AND status = 'confirmed'`,
      [calendarId],
    );
    const cancelledRow = await this.db.queryOne<{ count: string | number }>(
      `SELECT COUNT(*) AS count FROM events
       WHERE calendar_id = $1 AND status = 'cancelled'`,
      [calendarId],
    );
    const nextRow = await this.db.queryOne<{ next_event_at: Date | string | null }>(
      `SELECT MIN(starts_at_utc) AS next_event_at FROM events
       WHERE calendar_id = $1 AND active = true AND status = 'confirmed'
         AND starts_at_utc >= $2`,
      [calendarId, new Date().toISOString()],
    );
    return {
      active: Number(activeRow?.count ?? 0),
      cancelled: Number(cancelledRow?.count ?? 0),
      nextEventAt: nextRow?.next_event_at
        ? new Date(nextRow.next_event_at).toISOString()
        : null,
    };
  }

  async updateCalendarName(calendarId: string, name: string, now: string): Promise<void> {
    await this.db.exec(
      'UPDATE calendars SET name = $2, updated_at = $3 WHERE id = $1',
      [calendarId, name, now],
    );
  }

  async getActiveCalendarTokenPrefix(calendarId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ token_prefix: string }>(
      `SELECT token_prefix FROM calendar_tokens
       WHERE calendar_id = $1 AND status = 'active'`,
      [calendarId],
    );
    return row?.token_prefix ?? null;
  }

  async getLastSyncStatus(calendarId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ status: string }>(
      `SELECT status FROM sync_runs
       WHERE calendar_id = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      [calendarId],
    );
    return row?.status ?? null;
  }
}
