import { createDbClient, createPool, ensureRoleGrants, type AppDatabase } from '../../src/db/client.js';
import { createAppDatabase } from '../../src/db/app-database.js';
import { applyMigrations } from '../../src/db/migrate.js';

let probeResult: boolean | null = null;

/** True when a real Postgres is reachable for role/RLS integration tests. */
export async function probeRealPostgres(): Promise<boolean> {
  if (probeResult !== null) {
    return probeResult;
  }
  const databaseUrl =
    process.env.DATABASE_URL_TEST ??
    process.env.DATABASE_URL ??
    'postgresql://leo@127.0.0.1:5432/seqta_calendar_test';
  try {
    const pool = await createPool(databaseUrl);
    const db = createDbClient(pool);
    await db.queryOne('SELECT 1 AS ok');
    await db.close();
    probeResult = true;
  } catch {
    probeResult = false;
  }
  return probeResult;
}

export function hasRealPostgresEnv(): boolean {
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

  const db = createAppDatabase(pool);

  return {
    db,
    close: async () => {
      await pool.end();
    },
  };
}
