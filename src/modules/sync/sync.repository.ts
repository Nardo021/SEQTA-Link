import type { DbClient } from '../../db/client.js';

export interface SyncRunRecord {
  id: string;
  calendarId: string;
  deviceId: string;
  ownerUserId: string;
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
  calendar_id: string;
  device_id: string;
  owner_user_id: string;
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
    calendarId: row.calendar_id,
    deviceId: row.device_id,
    ownerUserId: row.owner_user_id,
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
  constructor(private readonly db: DbClient) {}

  async findSyncRunByIdempotencyKey(
    deviceId: string,
    idempotencyKey: string,
  ): Promise<SyncRunRecord | null> {
    const row = await this.db.queryOne<SyncRunRow>(
      `SELECT id, calendar_id, device_id, owner_user_id, idempotency_key, payload_hash, snapshot_hash,
              range_from, range_until, received_count, normalized_count, duplicate_count,
              inserted_count, updated_count, removed_count, restored_count, unchanged_count,
              status, error_code, started_at, completed_at
       FROM sync_runs
       WHERE device_id = $1 AND idempotency_key = $2`,
      [deviceId, idempotencyKey],
    );
    return row ? mapSyncRunRow(row) : null;
  }

  async createSyncRun(input: {
    id: string;
    ownerUserId: string;
    calendarId: string;
    deviceId: string;
    idempotencyKey: string;
    payloadHash: string;
    snapshotHash: string;
    rangeFrom: string;
    rangeUntil: string;
    receivedCount: number;
    normalizedCount: number;
    duplicateCount: number;
    startedAt: string;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO sync_runs (
        id, owner_user_id, calendar_id, device_id, idempotency_key, payload_hash, snapshot_hash,
        range_from, range_until,
        received_count, normalized_count, duplicate_count,
        inserted_count, updated_count, removed_count, restored_count, unchanged_count,
        status, started_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, 0, 0, 0, 'running', $13)`,
      [
        input.id,
        input.ownerUserId,
        input.calendarId,
        input.deviceId,
        input.idempotencyKey,
        input.payloadHash,
        input.snapshotHash,
        input.rangeFrom,
        input.rangeUntil,
        input.receivedCount,
        input.normalizedCount,
        input.duplicateCount,
        input.startedAt,
      ],
    );
  }

  async completeSyncRun(
    syncRunId: string,
    counts: {
      inserted: number;
      updated: number;
      removed: number;
      restored: number;
      unchanged: number;
    },
    completedAt: string,
  ): Promise<void> {
    await this.db.exec(
      `UPDATE sync_runs
       SET inserted_count = $2, updated_count = $3, removed_count = $4,
           restored_count = $5, unchanged_count = $6, status = 'success', completed_at = $7
       WHERE id = $1`,
      [
        syncRunId,
        counts.inserted,
        counts.updated,
        counts.removed,
        counts.restored,
        counts.unchanged,
        completedAt,
      ],
    );
  }

  async listByCalendar(calendarId: string, limit: number): Promise<SyncRunRecord[]> {
    const rows = await this.db.query<SyncRunRow>(
      `SELECT * FROM sync_runs
       WHERE calendar_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [calendarId, limit],
    );
    return rows.map(mapSyncRunRow);
  }
}
