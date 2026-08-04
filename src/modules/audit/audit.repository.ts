import type { DbClient } from '../../db/client.js';

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  actorType: string;
  targetUserId: string | null;
  action: string;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class AuditRepository {
  constructor(private readonly db: DbClient) {}

  async write(input: {
    actorUserId: string | null;
    actorType: string;
    targetUserId?: string | null;
    action: string;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO audit_logs (
        actor_user_id, actor_type, target_user_id, action, request_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.actorUserId,
        input.actorType,
        input.targetUserId ?? null,
        input.action,
        input.requestId ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async listRecent(limit: number, action?: string): Promise<AuditLogRecord[]> {
    const rows = action
      ? await this.db.query<{
          id: string;
          actor_user_id: string | null;
          actor_type: string;
          target_user_id: string | null;
          action: string;
          request_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        }>(
          `SELECT id, actor_user_id, actor_type, target_user_id, action, request_id, metadata, created_at
           FROM audit_logs
           WHERE action = $2
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit, action],
        )
      : await this.db.query<{
          id: string;
          actor_user_id: string | null;
          actor_type: string;
          target_user_id: string | null;
          action: string;
          request_id: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        }>(
          `SELECT id, actor_user_id, actor_type, target_user_id, action, request_id, metadata, created_at
           FROM audit_logs
           ORDER BY created_at DESC
           LIMIT $1`,
          [limit],
        );
    return rows.map((row) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorType: row.actor_type,
      targetUserId: row.target_user_id,
      action: row.action,
      requestId: row.request_id,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    }));
  }
}
