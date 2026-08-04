import type { DbClient } from '../../db/client.js';
import type { UserRecord } from '../../shared/types.js';

interface UserRow {
  id: string;
  oidc_issuer: string;
  oidc_subject: string;
  display_name: string;
  email: string | null;
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
    oidcIssuer: row.oidc_issuer,
    oidcSubject: row.oidc_subject,
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

  async findByOidc(issuer: string, subject: string): Promise<UserRecord | null> {
    const row = await this.db.queryOne<UserRow>(
      'SELECT * FROM users WHERE oidc_issuer = $1 AND oidc_subject = $2',
      [issuer, subject],
    );
    return row ? mapUserRow(row) : null;
  }

  async createUser(input: {
    id: string;
    oidcIssuer: string;
    oidcSubject: string;
    displayName: string;
    email?: string | null;
    role?: UserRecord['role'];
    now: string;
  }): Promise<UserRecord> {
    await this.db.exec(
      `INSERT INTO users (
        id, oidc_issuer, oidc_subject, display_name, email, role, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [
        input.id,
        input.oidcIssuer,
        input.oidcSubject,
        input.displayName,
        input.email ?? null,
        input.role ?? 'user',
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

  async updateUser(
    userId: string,
    fields: Partial<{
      displayName: string;
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
