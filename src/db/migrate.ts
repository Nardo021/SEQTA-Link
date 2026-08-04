import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DbClient } from './client.js';
import { createDbClient, createPool } from './client.js';
import { loadConfig } from '../config.js';
import { prepareDatabaseConnection } from './prepare-database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../database/migrations');

export const MIGRATION_FILES = [
  '001_v2_schema.sql',
  '002_rls_policies.sql',
  '003_db_roles.sql',
  '004_cli_lookup.sql',
  '005_local_auth.sql',
  '006_email_identity.sql',
  '007_admin_delete_grants.sql',
] as const;

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

export async function applyMigrations(db: DbClient): Promise<string[]> {
  const exists = await db.queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'schema_migrations'
     ) AS exists`,
  );
  if (!exists?.exists) {
    await db.exec(`
      CREATE TABLE schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  const appliedRows = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations',
  );
  const applied = new Set(appliedRows.map((row) => row.version));

  const newlyApplied: string[] = [];
  for (const file of listMigrationFiles()) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    await db.exec(sql);
    await db.exec(
      'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())',
      [file],
    );
    newlyApplied.push(file);
  }

  return newlyApplied;
}

export async function getAppliedMigrations(db: DbClient): Promise<string[]> {
  const rows = await db.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  return rows.map((row) => row.version);
}

export async function isMigrationComplete(db: DbClient): Promise<boolean> {
  const applied = new Set(await getAppliedMigrations(db));
  return MIGRATION_FILES.every((file) => applied.has(file));
}

async function runCli(): Promise<void> {
  const config = loadConfig();
  const prepared = await prepareDatabaseConnection(config);
  const pool = await createPool(prepared.databaseUrl);
  const db = createDbClient(pool);
  try {
    const applied = await applyMigrations(db);
    if (applied.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Applied migrations: ${applied.join(', ')}`);
    }
  } finally {
    await db.close();
    await prepared.stop();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
