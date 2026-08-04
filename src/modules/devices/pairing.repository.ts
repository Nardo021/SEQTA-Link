import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';

export interface PairingCodeRecord {
  id: string;
  ownerUserId: string;
  calendarId: string;
  expiresAt: string;
}

export class PairingRepository {
  constructor(private readonly db: DbClient) {}

  async createPairingCode(input: {
    id: string;
    ownerUserId: string;
    calendarId: string;
    codeHash: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO pairing_codes (id, owner_user_id, calendar_id, code_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.id,
        input.ownerUserId,
        input.calendarId,
        input.codeHash,
        input.expiresAt,
        input.now,
      ],
    );
  }

  async findActiveByHash(codeHash: string): Promise<PairingCodeRecord | null> {
    const row = await this.db.queryOne<{
      id: string;
      owner_user_id: string;
      calendar_id: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, owner_user_id, calendar_id, expires_at, used_at
       FROM pairing_codes
       WHERE code_hash = $1`,
      [codeHash],
    );
    if (!row || row.used_at) {
      return null;
    }
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      calendarId: row.calendar_id,
      expiresAt: row.expires_at,
    };
  }

  async markUsed(pairingCodeId: string, deviceId: string, now: string): Promise<void> {
    await this.db.exec(
      `UPDATE pairing_codes SET used_at = $2, device_id = $3 WHERE id = $1`,
      [pairingCodeId, now, deviceId],
    );
  }

  async listPendingByOwner(
    ownerUserId: string,
  ): Promise<Array<{ id: string; expiresAt: string; createdAt: string }>> {
    const rows = await this.db.query<{ id: string; expires_at: string; created_at: string }>(
      `SELECT id, expires_at, created_at
       FROM pairing_codes
       WHERE owner_user_id = $1
         AND used_at IS NULL
         AND expires_at > $2
       ORDER BY created_at DESC`,
      [ownerUserId, nowIso()],
    );
    return rows.map((row) => ({
      id: row.id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  async cancelPending(ownerUserId: string, pairingCodeId: string): Promise<boolean> {
    const now = nowIso();
    const row = await this.db.queryOne<{ id: string }>(
      `UPDATE pairing_codes
       SET used_at = $3, expires_at = $3
       WHERE id = $1
         AND owner_user_id = $2
         AND used_at IS NULL
       RETURNING id`,
      [pairingCodeId, ownerUserId, now],
    );
    return Boolean(row);
  }
}
