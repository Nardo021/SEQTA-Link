import type { DbClient } from '../../db/client.js';

export interface SourceIdentityRecord {
  calendarId: string;
  schoolHost: string;
  studentRef: string;
  lockedAt: string;
}

export class SourceIdentityRepository {
  constructor(private readonly db: DbClient) {}

  async findByCalendarId(calendarId: string): Promise<SourceIdentityRecord | null> {
    const row = await this.db.queryOne<{
      calendar_id: string;
      school_host: string;
      student_ref: string;
      locked_at: string;
    }>(
      `SELECT calendar_id, school_host, student_ref, locked_at
       FROM source_identities WHERE calendar_id = $1`,
      [calendarId],
    );
    if (!row) {
      return null;
    }
    return {
      calendarId: row.calendar_id,
      schoolHost: row.school_host,
      studentRef: row.student_ref,
      lockedAt: row.locked_at,
    };
  }

  async lockIdentity(input: {
    calendarId: string;
    schoolHost: string;
    studentRef: string;
    now: string;
  }): Promise<SourceIdentityRecord> {
    await this.db.exec(
      `INSERT INTO source_identities (calendar_id, school_host, student_ref, locked_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (calendar_id) DO NOTHING`,
      [input.calendarId, input.schoolHost, input.studentRef, input.now],
    );
    const identity = await this.findByCalendarId(input.calendarId);
    if (!identity) {
      throw new Error('Failed to lock source identity');
    }
    return identity;
  }

  async resetIdentity(calendarId: string, resetBy: string, now: string): Promise<void> {
    await this.db.exec(
      `UPDATE source_identities
       SET reset_at = $2, reset_by = $3
       WHERE calendar_id = $1`,
      [calendarId, now, resetBy],
    );
    await this.db.exec('DELETE FROM source_identities WHERE calendar_id = $1', [calendarId]);
  }
}
