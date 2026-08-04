import type { DbClient } from '../../db/client.js';
import type { UserRecord } from '../../shared/types.js';

interface UserRow {
  id: string;
  display_name: string;
  email: string | null;
  password_hash: string | null;
  role: 'owner' | 'admin' | 'user';
  account_status: 'active' | 'suspended' | 'deleted';
  sync_enabled: boolean;
  feed_enabled: boolean;
  max_devices: number;
  created_at: string;
  updated_at: string;
}

function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    accountStatus: row.account_status,
    syncEnabled: row.sync_enabled,
    feedEnabled: row.feed_enabled,
    maxDevices: row.max_devices,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UserRepository {
  constructor(private readonly db: DbClient) {}

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.db.queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return row ? mapUserRow(row) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db.queryOne<UserRow>(
      'SELECT * FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    return row ? mapUserRow(row) : null;
  }

  async countOwners(): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM users
       WHERE role = 'owner' AND account_status = 'active'`,
    );
    return Number(row?.n ?? 0);
  }

  async getPasswordHash(userId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ password_hash: string | null }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    return row?.password_hash ?? null;
  }

  async createUser(input: {
    id: string;
    displayName: string;
    email?: string | null;
    passwordHash?: string | null;
    role?: UserRecord['role'];
    syncEnabled?: boolean;
    feedEnabled?: boolean;
    maxDevices?: number;
    now: string;
  }): Promise<UserRecord> {
    await this.db.exec(
      `INSERT INTO users (
        id, display_name, email, password_hash,
        role, sync_enabled, feed_enabled, max_devices, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        input.id,
        input.displayName,
        input.email ?? null,
        input.passwordHash ?? null,
        input.role ?? 'user',
        input.syncEnabled ?? true,
        input.feedEnabled ?? true,
        input.maxDevices ?? 3,
        input.now,
      ],
    );
    const user = await this.findById(input.id);
    if (!user) {
      throw new Error('Failed to create user');
    }
    return user;
  }

  async listUsers(): Promise<UserRecord[]> {
    const rows = await this.db.query<UserRow>(
      'SELECT * FROM users ORDER BY created_at DESC',
    );
    return rows.map(mapUserRow);
  }

  async countByAccountStatus(): Promise<{ total: number; active: number; suspended: number }> {
    const row = await this.db.queryOne<{ total: string; active: string; suspended: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE account_status = 'active')::text AS active,
         COUNT(*) FILTER (WHERE account_status = 'suspended')::text AS suspended
       FROM users`,
    );
    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      suspended: Number(row?.suspended ?? 0),
    };
  }

  async updateUser(
    userId: string,
    fields: Partial<{
      displayName: string;
      email: string | null;
      passwordHash: string | null;
      syncEnabled: boolean;
      feedEnabled: boolean;
      maxDevices: number;
      accountStatus: UserRecord['accountStatus'];
      role: UserRecord['role'];
    }>,
    now: string,
  ): Promise<UserRecord | null> {
    const sets: string[] = ['updated_at = $2'];
    const params: unknown[] = [userId, now];
    let idx = 3;

    if (fields.displayName !== undefined) {
      sets.push(`display_name = $${idx++}`);
      params.push(fields.displayName);
    }
    if (fields.email !== undefined) {
      sets.push(`email = $${idx++}`);
      params.push(fields.email);
    }
    if (fields.passwordHash !== undefined) {
      sets.push(`password_hash = $${idx++}`);
      params.push(fields.passwordHash);
    }
    if (fields.syncEnabled !== undefined) {
      sets.push(`sync_enabled = $${idx++}`);
      params.push(fields.syncEnabled);
    }
    if (fields.feedEnabled !== undefined) {
      sets.push(`feed_enabled = $${idx++}`);
      params.push(fields.feedEnabled);
    }
    if (fields.maxDevices !== undefined) {
      sets.push(`max_devices = $${idx++}`);
      params.push(fields.maxDevices);
    }
    if (fields.accountStatus !== undefined) {
      sets.push(`account_status = $${idx++}`);
      params.push(fields.accountStatus);
      if (fields.accountStatus === 'suspended') {
        sets.push(`suspended_at = $${idx++}`);
        params.push(now);
      }
      if (fields.accountStatus === 'deleted') {
        sets.push(`deleted_at = $${idx++}`);
        params.push(now);
      }
    }
    if (fields.role !== undefined) {
      sets.push(`role = $${idx++}`);
      params.push(fields.role);
    }

    await this.db.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
    return this.findById(userId);
  }

  async applyInvitationSettings(
    userId: string,
    settings: {
      syncEnabled: boolean;
      feedEnabled: boolean;
      maxDevices: number;
      displayName?: string | null;
    },
    now: string,
  ): Promise<UserRecord | null> {
    return this.updateUser(
      userId,
      {
        syncEnabled: settings.syncEnabled,
        feedEnabled: settings.feedEnabled,
        maxDevices: settings.maxDevices,
        displayName: settings.displayName ?? undefined,
      },
      now,
    );
  }
}
