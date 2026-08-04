import { createDbClient, createPool, ensureRoleGrants, type AppDatabase } from '../../src/db/client.js';
import { attachRoleClients } from '../../src/db/app-database.js';
import { applyMigrations } from '../../src/db/migrate.js';

export function hasRealPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL_TEST || process.env.DATABASE_URL);
}

export async function createRealTestDatabase(): Promise<{
  db: AppDatabase;
  close: () => Promise<void>;
}> {
  const databaseUrl =
    process.env.DATABASE_URL_TEST ??
    process.env.DATABASE_URL ??
    'postgresql://leo@127.0.0.1:5432/seqta_calendar_test';

  const pool = await createPool(databaseUrl);
  const bootstrap = createDbClient(pool);
  await applyMigrations(bootstrap);
  await ensureRoleGrants(bootstrap);

  await bootstrap.exec(`
    TRUNCATE TABLE
      audit_logs,
      sync_runs,
      event_aliases,
      events,
      pairing_codes,
      devices,
      calendar_tokens,
      source_identities,
      calendars,
      sessions,
      invitations,
      users
    RESTART IDENTITY CASCADE
  `);

  const device = createDbClient(pool, 'seqta_device_api');
  const db = attachRoleClients(pool, device);

  return {
    db,
    close: async () => {
      await pool.end();
    },
  };
}
