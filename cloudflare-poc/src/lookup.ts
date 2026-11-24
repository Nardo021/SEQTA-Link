import { hashToken } from "./compat";

/** Read-only D1 token lookup prototype. Not an HTTP endpoint or full authentication. */
export async function resolveCalendarToken(
  db: D1Database,
  pepper: Uint8Array,
  rawToken: string,
): Promise<{ status: 200 | 404 | 410; revision?: number; etag?: string }> {
  if (!/^sl_cal_[A-Za-z0-9_-]+$/.test(rawToken)) return { status: 404 };
  const tokenHash = await hashToken(pepper, "calendar", rawToken);
  const row = await db.prepare(`
    SELECT ct.status AS token_status, u.account_status,
           u.feed_enabled, c.revision
    FROM calendar_tokens ct
    JOIN calendars c ON c.id = ct.calendar_id
    JOIN users u ON u.id = c.owner_user_id
    WHERE ct.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first<{
    token_status: string;
    account_status: string;
    feed_enabled: number;
    revision: number;
  }>();
  if (!row || row.token_status !== "active") return { status: 404 };
  if (row.account_status !== "active" || row.feed_enabled !== 1) return { status: 410 };
  return { status: 200, revision: row.revision, etag: `"calendar-${row.revision}"` };
}
