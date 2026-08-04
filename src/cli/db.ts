import {
  createDbClient,
  createPool,
  ensureRoleGrants,
  type AppDatabase,
  type DbClient,
} from '../db/client.js';
import { createAppDatabase } from '../db/app-database.js';
import { applyMigrations } from '../db/migrate.js';
import { prepareDatabaseConnection } from '../db/prepare-database.js';
import { loadConfig, type AppConfig } from '../config.js';
import {
  bootstrapCalendar,
  type BootstrapCalendarInput,
} from '../modules/calendars/calendar-bootstrap.js';
import { createTokenService, type TokenService } from '../security/token.service.js';

export interface DbHandle {
  db: AppDatabase;
  config: AppConfig;
  tokenService: TokenService;
  pool: Awaited<ReturnType<typeof createPool>>;
  stopEmbedded: () => Promise<void>;
}

export async function openDatabase(databaseUrl?: string): Promise<DbHandle> {
  const config = loadConfig({
    ...process.env,
    ...(databaseUrl
      ? { DATABASE_URL: databaseUrl, EMBEDDED_PG: 'false' }
      : {}),
  });
  const prepared = await prepareDatabaseConnection(config);
  const pool = await createPool(prepared.databaseUrl);
  const bootstrap = createDbClient(pool);
  await applyMigrations(bootstrap);
  await ensureRoleGrants(bootstrap);
  const db = createAppDatabase(pool);
  return {
    db,
    config,
    tokenService: createTokenService(config),
    pool,
    stopEmbedded: prepared.stop,
  };
}

export async function closeDatabase(handle: {
  db: AppDatabase;
  stopEmbedded: () => Promise<void>;
}): Promise<void> {
  await handle.db.close();
  await handle.stopEmbedded();
}

/** Test/CLI helper: one-shot user+calendar+upload device. */
export function createTestFeed(db: DbClient, config: AppConfig, input: BootstrapCalendarInput) {
  return bootstrapCalendar(db, config, createTokenService(config), input);
}

export function testSecretsEnv(): Record<string, string> {
  return {
    TOKEN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
    UID_SECRET: Buffer.alloc(32, 2).toString('base64'),
    SESSION_SECRET: Buffer.alloc(32, 3).toString('base64'),
    EMBEDDED_PG: 'false',
    ALLOWED_ORIGINS: 'https://learn.masada.onseqtacloud.com',
  };
}
