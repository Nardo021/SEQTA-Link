import type { AppDatabase, DbClient } from '../../src/db/client.js';

export async function queryOne<T>(
  db: DbClient | AppDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const client = 'admin' in db ? db.admin : db;
  return client.queryOne<T>(sql, params);
}
