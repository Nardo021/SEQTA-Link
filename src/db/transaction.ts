import type { DbClient } from './client.js';

export async function runTransaction<T>(
  db: DbClient,
  fn: (tx: DbClient) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
