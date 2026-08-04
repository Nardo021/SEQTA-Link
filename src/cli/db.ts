import {
  createDbClient,
  createPool,
  ensureRoleGrants,
  type AppDatabase,
  type DbClient,
} from '../db/client.js';
import { attachRoleClients } from '../db/app-database.js';
import { applyMigrations } from '../db/migrate.js';
import { loadConfig, type AppConfig } from '../config.js';
import { createCalendarService as scopedCreateCalendarService } from '../services/scoped-services.js';
import { createTokenService } from '../modules/feeds/token.service.js';
import type { CalendarService } from '../modules/calendars/calendar.service.js';

export async function openDatabase(databaseUrl?: string): Promise<{
  db: AppDatabase;
  config: AppConfig;
  pool: Awaited<ReturnType<typeof createPool>>;
}> {
  const config = loadConfig({
    ...process.env,
    ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
  });
  const pool = await createPool(config.databaseUrl);
  const bootstrap = createDbClient(pool);
  await applyMigrations(bootstrap);
  await ensureRoleGrants(bootstrap);
  const device = createDbClient(pool, 'seqta_device_api');
  const db = attachRoleClients(pool, device);
  return { db, config, pool };
}

export function createCalendarService(db: DbClient, config: AppConfig): CalendarService {
  return scopedCreateCalendarService(db, config, createTokenService(config));
}

export function testSecretsEnv(): Record<string, string> {
  return {
    TOKEN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
    UID_SECRET: Buffer.alloc(32, 2).toString('base64'),
    ALLOWED_ORIGINS: 'https://learn.masada.onseqtacloud.com',
  };
}
