import { createDbClient, type AppDatabase, type DbClient } from './client.js';
import type { Pool } from 'pg';

export function attachRoleClients(pool: Pool, primary: DbClient): AppDatabase {
  return Object.assign(primary, {
    migrator: createDbClient(pool, 'seqta_migrator'),
    device: primary,
    feed: createDbClient(pool, 'seqta_feed_api'),
    cli: createDbClient(pool, 'seqta_cli'),
    user: createDbClient(pool, 'seqta_user_api'),
    admin: createDbClient(pool, 'seqta_admin_api'),
    backup: createDbClient(pool, 'seqta_backup'),
  });
}

export function wrapDbAsAppDatabase(db: DbClient): AppDatabase {
  return Object.assign(db, {
    migrator: db,
    device: db,
    feed: db,
    cli: db,
    user: db,
    admin: db,
    backup: db,
  });
}
