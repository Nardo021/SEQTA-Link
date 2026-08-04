import type { DbClient } from '../../db/client.js';

export interface InvitationRecord {
  id: string;
  expectedName: string | null;
  note: string | null;
  syncEnabled: boolean;
  feedEnabled: boolean;
  maxDevices: number;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
  createdAt: string;
}

export class InvitationRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: {
    id: string;
    tokenHash: string;
    createdBy: string;
    expectedName?: string | null;
    note?: string | null;
    syncEnabled: boolean;
    feedEnabled: boolean;
    maxDevices: number;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO invitations (
        id, token_hash, created_by, expected_name, note,
        sync_enabled, feed_enabled, max_devices, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.id,
        input.tokenHash,
        input.createdBy,
        input.expectedName ?? null,
        input.note ?? null,
        input.syncEnabled,
        input.feedEnabled,
        input.maxDevices,
        input.expiresAt,
        input.now,
      ],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const row = await this.db.queryOne<{
      id: string;
      expected_name: string | null;
      note: string | null;
      sync_enabled: boolean;
      feed_enabled: boolean;
      max_devices: number;
      expires_at: string;
      used_at: string | null;
      used_by: string | null;
      created_at: string;
    }>(
      `SELECT id, expected_name, note, sync_enabled, feed_enabled, max_devices,
              expires_at, used_at, used_by, created_at
       FROM invitations WHERE token_hash = $1`,
      [tokenHash],
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      expectedName: row.expected_name,
      note: row.note,
      syncEnabled: row.sync_enabled,
      feedEnabled: row.feed_enabled,
      maxDevices: row.max_devices,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      usedBy: row.used_by,
      createdAt: row.created_at,
    };
  }

  async listActive(): Promise<InvitationRecord[]> {
    const rows = await this.db.query<{
      id: string;
      expected_name: string | null;
      note: string | null;
      sync_enabled: boolean;
      feed_enabled: boolean;
      max_devices: number;
      expires_at: string;
      used_at: string | null;
      used_by: string | null;
      created_at: string;
    }>(
      `SELECT id, expected_name, note, sync_enabled, feed_enabled, max_devices,
              expires_at, used_at, used_by, created_at
       FROM invitations
       ORDER BY created_at DESC
       LIMIT 100`,
    );
    return rows.map((row) => ({
      id: row.id,
      expectedName: row.expected_name,
      note: row.note,
      syncEnabled: row.sync_enabled,
      feedEnabled: row.feed_enabled,
      maxDevices: row.max_devices,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      usedBy: row.used_by,
      createdAt: row.created_at,
    }));
  }

  async markUsed(invitationId: string, userId: string, now: string): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      `UPDATE invitations SET used_at = $2, used_by = $3
       WHERE id = $1 AND used_at IS NULL
       RETURNING id`,
      [invitationId, now, userId],
    );
    return Boolean(row);
  }

  async deleteUnused(invitationId: string): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      `DELETE FROM invitations WHERE id = $1 AND used_at IS NULL RETURNING id`,
      [invitationId],
    );
    return Boolean(row);
  }
}
