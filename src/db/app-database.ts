import { createDbClient, type AppDatabase, type DbClient } from './client.js';
import type { Pool } from 'pg';

export function createAppDatabase(pool: Pool): AppDatabase {
  const device = createDbClient(pool, 'seqta_device_api');
  return {
    migrator: createDbClient(pool, 'seqta_migrator'),
    device,
    feed: createDbClient(pool, 'seqta_feed_api'),
    cli: createDbClient(pool, 'seqta_cli'),
    user: createDbClient(pool, 'seqta_user_api'),
    admin: createDbClient(pool, 'seqta_admin_api'),
    backup: createDbClient(pool, 'seqta_backup'),
    close: async () => {
      await device.close();
    },
  };
}

/** Collapse all role handles onto one client (pg-mem / unit tests without SET ROLE). */
export function wrapDbAsAppDatabase(db: DbClient): AppDatabase {
  return {
    migrator: db,
    device: db,
    feed: db,
    cli: db,
    user: db,
    admin: db,
    backup: db,
    close: () => db.close(),
  };
}
