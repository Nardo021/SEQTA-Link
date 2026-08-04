import type { DbClient } from '../db/client.js';
import { AppError } from '../shared/errors.js';

/** Resolve calendar owner via SECURITY DEFINER (seqta_cli), then run under RLS user context. */
export async function withCalendarOwnerContext<T>(
  db: DbClient,
  calendarId: string,
  fn: (client: DbClient, ownerUserId: string) => Promise<T>,
): Promise<T> {
  const row = await db.queryOne<{ owner_user_id: string }>(
    'SELECT lookup_calendar_owner($1) AS owner_user_id',
    [calendarId],
  );
  const ownerUserId = row?.owner_user_id;
  if (!ownerUserId) {
    throw new AppError('INVALID_REQUEST', 'Calendar not found.', 404);
  }
  return db.withUserContext(ownerUserId, (client) => fn(client, ownerUserId));
}
