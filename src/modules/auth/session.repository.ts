import type { DbClient } from '../../db/client.js';

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
}

export class SessionRepository {
  constructor(private readonly db: DbClient) {}

  async createSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    now: string;
  }): Promise<void> {
    await this.db.exec(
      `INSERT INTO sessions (id, user_id, session_token_hash, expires_at, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [input.id, input.userId, input.tokenHash, input.expiresAt, input.now],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.db.queryOne<{
      id: string;
      user_id: string;
      expires_at: string;
    }>(
      `SELECT id, user_id, expires_at FROM sessions
       WHERE session_token_hash = $1 AND expires_at > now()`,
      [tokenHash],
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      expiresAt: row.expires_at,
    };
  }

  async touchSession(sessionId: string, now: string): Promise<void> {
    await this.db.exec('UPDATE sessions SET last_seen_at = $2 WHERE id = $1', [sessionId, now]);
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.exec('DELETE FROM sessions WHERE session_token_hash = $1', [tokenHash]);
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.db.exec('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
}
