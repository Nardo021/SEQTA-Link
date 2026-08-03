import type { Database } from 'better-sqlite3';
import type { FeedRecord } from '../../shared/types.js';

interface FeedRow {
  id: string;
  name: string;
  school_host: string;
  student_ref: string;
  timezone: string;
  revision: number;
  last_changed_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapFeedRow(row: FeedRow): FeedRecord {
  return {
    id: row.id,
    name: row.name,
    schoolHost: row.school_host,
    studentRef: row.student_ref,
    timezone: row.timezone,
    revision: row.revision,
    lastChangedAt: row.last_changed_at,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class FeedRepository {
  constructor(private readonly db: Database) {}

  findByUploadTokenHash(hash: string): FeedRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, school_host, student_ref, timezone, revision,
                last_changed_at, last_synced_at, created_at, updated_at
         FROM feeds WHERE upload_token_hash = ?`,
      )
      .get(hash) as FeedRow | undefined;
    return row ? mapFeedRow(row) : null;
  }

  findByCalendarTokenHash(hash: string): FeedRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, school_host, student_ref, timezone, revision,
                last_changed_at, last_synced_at, created_at, updated_at
         FROM feeds WHERE calendar_token_hash = ?`,
      )
      .get(hash) as FeedRow | undefined;
    return row ? mapFeedRow(row) : null;
  }

  findById(id: string): FeedRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, school_host, student_ref, timezone, revision,
                last_changed_at, last_synced_at, created_at, updated_at
         FROM feeds WHERE id = ?`,
      )
      .get(id) as FeedRow | undefined;
    return row ? mapFeedRow(row) : null;
  }

  createFeed(input: {
    id: string;
    name: string;
    schoolHost: string;
    studentRef: string;
    timezone: string;
    uploadTokenHash: string;
    calendarTokenHash: string;
    now: string;
  }): FeedRecord {
    this.db
      .prepare(
        `INSERT INTO feeds (
          id, name, school_host, student_ref, timezone,
          upload_token_hash, calendar_token_hash,
          revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.schoolHost,
        input.studentRef,
        input.timezone,
        input.uploadTokenHash,
        input.calendarTokenHash,
        input.now,
        input.now,
      );

    const feed = this.findById(input.id);
    if (!feed) {
      throw new Error('Failed to create feed');
    }
    return feed;
  }

  updateTokenHash(feedId: string, type: 'upload' | 'calendar', hash: string, now: string): void {
    if (type === 'upload') {
      this.db
        .prepare('UPDATE feeds SET upload_token_hash = ?, updated_at = ? WHERE id = ?')
        .run(hash, now, feedId);
      return;
    }
    this.db
      .prepare('UPDATE feeds SET calendar_token_hash = ?, updated_at = ? WHERE id = ?')
      .run(hash, now, feedId);
  }

  incrementRevision(feedId: string, now: string): number {
    this.db
      .prepare(
        `UPDATE feeds
         SET revision = revision + 1, last_changed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, feedId);
    const row = this.db.prepare('SELECT revision FROM feeds WHERE id = ?').get(feedId) as {
      revision: number;
    };
    return row.revision;
  }

  updateLastSynced(feedId: string, now: string): void {
    this.db
      .prepare('UPDATE feeds SET last_synced_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, feedId);
  }

  getEventStats(feedId: string): {
    active: number;
    cancelled: number;
    nextEventAt: string | null;
  } {
    const activeRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE feed_id = ? AND active = 1 AND status = 'confirmed'`,
      )
      .get(feedId) as { count: number };

    const cancelledRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE feed_id = ? AND status = 'cancelled'`,
      )
      .get(feedId) as { count: number };

    const nextRow = this.db
      .prepare(
        `SELECT MIN(starts_at_utc) AS next_event_at FROM events
         WHERE feed_id = ? AND active = 1 AND status = 'confirmed'
           AND starts_at_utc >= ?`,
      )
      .get(feedId, new Date().toISOString()) as { next_event_at: string | null };

    return {
      active: activeRow.count,
      cancelled: cancelledRow.count,
      nextEventAt: nextRow.next_event_at,
    };
  }

  getLastSyncStatus(feedId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT status FROM sync_runs
         WHERE feed_id = ?
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get(feedId) as { status: string } | undefined;
    return row?.status ?? null;
  }
}
