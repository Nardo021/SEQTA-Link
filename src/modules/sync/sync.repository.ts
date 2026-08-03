import type { Database } from 'better-sqlite3';

export interface SyncRunRecord {
  id: string;
  feedId: string;
  idempotencyKey: string;
  payloadHash: string;
  snapshotHash: string;
  rangeFrom: string;
  rangeUntil: string;
  receivedCount: number;
  normalizedCount: number;
  duplicateCount: number;
  insertedCount: number;
  updatedCount: number;
  removedCount: number;
  restoredCount: number;
  unchangedCount: number;
  status: string;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface SyncRunRow {
  id: string;
  feed_id: string;
  idempotency_key: string;
  payload_hash: string;
  snapshot_hash: string;
  range_from: string;
  range_until: string;
  received_count: number;
  normalized_count: number;
  duplicate_count: number;
  inserted_count: number;
  updated_count: number;
  removed_count: number;
  restored_count: number;
  unchanged_count: number;
  status: string;
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
}

function mapSyncRunRow(row: SyncRunRow): SyncRunRecord {
  return {
    id: row.id,
    feedId: row.feed_id,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    snapshotHash: row.snapshot_hash,
    rangeFrom: row.range_from,
    rangeUntil: row.range_until,
    receivedCount: row.received_count,
    normalizedCount: row.normalized_count,
    duplicateCount: row.duplicate_count,
    insertedCount: row.inserted_count,
    updatedCount: row.updated_count,
    removedCount: row.removed_count,
    restoredCount: row.restored_count,
    unchangedCount: row.unchanged_count,
    status: row.status,
    errorCode: row.error_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export class SyncRepository {
  constructor(private readonly db: Database) {}

  findSyncRunByIdempotencyKey(feedId: string, idempotencyKey: string): SyncRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, feed_id, idempotency_key, payload_hash, snapshot_hash,
                range_from, range_until, received_count, normalized_count, duplicate_count,
                inserted_count, updated_count, removed_count, restored_count, unchanged_count,
                status, error_code, started_at, completed_at
         FROM sync_runs
         WHERE feed_id = ? AND idempotency_key = ?`,
      )
      .get(feedId, idempotencyKey) as SyncRunRow | undefined;

    return row ? mapSyncRunRow(row) : null;
  }

  createSyncRun(input: {
    id: string;
    feedId: string;
    idempotencyKey: string;
    payloadHash: string;
    snapshotHash: string;
    rangeFrom: string;
    rangeUntil: string;
    receivedCount: number;
    normalizedCount: number;
    duplicateCount: number;
    startedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sync_runs (
          id, feed_id, idempotency_key, payload_hash, snapshot_hash,
          range_from, range_until,
          received_count, normalized_count, duplicate_count,
          inserted_count, updated_count, removed_count, restored_count, unchanged_count,
          status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'running', ?)`,
      )
      .run(
        input.id,
        input.feedId,
        input.idempotencyKey,
        input.payloadHash,
        input.snapshotHash,
        input.rangeFrom,
        input.rangeUntil,
        input.receivedCount,
        input.normalizedCount,
        input.duplicateCount,
        input.startedAt,
      );
  }

  completeSyncRun(
    syncRunId: string,
    counts: {
      inserted: number;
      updated: number;
      removed: number;
      restored: number;
      unchanged: number;
    },
    completedAt: string,
  ): void {
    this.db
      .prepare(
        `UPDATE sync_runs
         SET inserted_count = ?, updated_count = ?, removed_count = ?,
             restored_count = ?, unchanged_count = ?, status = 'success', completed_at = ?
         WHERE id = ?`,
      )
      .run(
        counts.inserted,
        counts.updated,
        counts.removed,
        counts.restored,
        counts.unchanged,
        completedAt,
        syncRunId,
      );
  }
}
