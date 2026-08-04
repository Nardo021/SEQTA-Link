import type { DbClient } from '../../db/client.js';
import type { CalendarRecord, DeviceRecord } from '../../shared/types.js';
import { CalendarRepository } from '../calendars/calendar.repository.js';

export class DeviceRepository {
  constructor(private readonly db: DbClient) {}

  async findByTokenHash(hash: string): Promise<(DeviceRecord & { calendar: CalendarRecord }) | null> {
    const deviceRow = await this.db.queryOne<{
      id: string;
      owner_user_id: string;
      calendar_id: string;
      name: string;
      token_prefix: string;
      status: 'active' | 'revoked';
      created_at: string;
      last_seen_at: string | null;
      last_synced_at: string | null;
    }>(
      `SELECT id, owner_user_id, calendar_id, name, token_prefix, status,
              created_at, last_seen_at, last_synced_at
       FROM devices
       WHERE token_hash = $1 AND status = 'active'`,
      [hash],
    );
    if (!deviceRow) {
      return null;
    }
    const calendar = await new CalendarRepository(this.db).findById(deviceRow.calendar_id);
    if (!calendar) {
      return null;
    }
    return {
      id: deviceRow.id,
      ownerUserId: deviceRow.owner_user_id,
      calendarId: deviceRow.calendar_id,
      name: deviceRow.name,
      tokenPrefix: deviceRow.token_prefix,
      status: deviceRow.status,
      createdAt: deviceRow.created_at,
      lastSeenAt: deviceRow.last_seen_at,
      lastSyncedAt: deviceRow.last_synced_at,
      calendar,
    };
  }

  async createDevice(input: {
    id: string;
    ownerUserId: string;
    calendarId: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
    now: string;
  }): Promise<DeviceRecord> {
    await this.db.exec(
      `INSERT INTO devices (
        id, owner_user_id, calendar_id, name, token_hash, token_prefix, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
      [
        input.id,
        input.ownerUserId,
        input.calendarId,
        input.name,
        input.tokenHash,
        input.tokenPrefix,
        input.now,
      ],
    );
    return {
      id: input.id,
      ownerUserId: input.ownerUserId,
      calendarId: input.calendarId,
      name: input.name,
      tokenPrefix: input.tokenPrefix,
      status: 'active',
      createdAt: input.now,
      lastSeenAt: null,
      lastSyncedAt: null,
    };
  }

  async touchSync(deviceId: string, now: string): Promise<void> {
    await this.db.exec(
      'UPDATE devices SET last_seen_at = $2, last_synced_at = $2 WHERE id = $1',
      [deviceId, now],
    );
  }

  async countActiveByOwner(ownerUserId: string): Promise<number> {
    const row = await this.db.queryOne<{ count: string | number }>(
      `SELECT COUNT(*) AS count FROM devices
       WHERE owner_user_id = $1 AND status = 'active'`,
      [ownerUserId],
    );
    return Number(row?.count ?? 0);
  }

  async listByOwner(ownerUserId: string): Promise<DeviceRecord[]> {
    const rows = await this.db.query<{
      id: string;
      owner_user_id: string;
      calendar_id: string;
      name: string;
      token_prefix: string;
      status: 'active' | 'revoked';
      created_at: string;
      last_seen_at: string | null;
      last_synced_at: string | null;
    }>(
      `SELECT id, owner_user_id, calendar_id, name, token_prefix, status,
              created_at, last_seen_at, last_synced_at
       FROM devices
       WHERE owner_user_id = $1
       ORDER BY created_at DESC`,
      [ownerUserId],
    );
    return rows.map((row) => ({
      id: row.id,
      ownerUserId: row.owner_user_id,
      calendarId: row.calendar_id,
      name: row.name,
      tokenPrefix: row.token_prefix,
      status: row.status,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      lastSyncedAt: row.last_synced_at,
    }));
  }

  async revokeDevice(deviceId: string, ownerUserId: string, now: string): Promise<boolean> {
    const result = await this.db.queryOne<{ id: string }>(
      `UPDATE devices
       SET status = 'revoked', revoked_at = $3
       WHERE id = $1 AND owner_user_id = $2 AND status = 'active'
       RETURNING id`,
      [deviceId, ownerUserId, now],
    );
    return Boolean(result);
  }

  async findDeviceOwner(
    deviceId: string,
  ): Promise<{ id: string; ownerUserId: string; name: string; status: string } | null> {
    const row = await this.db.queryOne<{
      id: string;
      owner_user_id: string;
      name: string;
      status: string;
    }>(
      `SELECT id, owner_user_id, name, status FROM devices WHERE id = $1`,
      [deviceId],
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      name: row.name,
      status: row.status,
    };
  }

  async revokeDeviceById(deviceId: string, now: string): Promise<boolean> {
    const result = await this.db.queryOne<{ id: string }>(
      `UPDATE devices SET status = 'revoked', revoked_at = $2
       WHERE id = $1 AND status = 'active'
       RETURNING id`,
      [deviceId, now],
    );
    return Boolean(result);
  }

  async revokeAllForOwner(ownerUserId: string, now: string): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE devices SET status = 'revoked', revoked_at = $2
       WHERE owner_user_id = $1 AND status = 'active'
       RETURNING id`,
      [ownerUserId, now],
    );
    return rows.length;
  }
}
