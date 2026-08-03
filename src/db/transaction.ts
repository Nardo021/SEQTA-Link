import type { Database } from 'better-sqlite3';

export interface TransactionContext {
  db: Database;
}

export function runImmediateTransaction<T>(
  db: Database,
  fn: (ctx: TransactionContext) => T,
): T {
  db.prepare('BEGIN IMMEDIATE').run();
  try {
    const result = fn({ db });
    db.prepare('COMMIT').run();
    return result;
  } catch (error) {
    db.prepare('ROLLBACK').run();
    throw error;
  }
}
