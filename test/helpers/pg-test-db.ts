import { randomUUID } from 'node:crypto';
import { newDb, type IMemoryDb } from 'pg-mem';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient, type AppDatabase } from '../../src/db/client.js';
import { wrapDbAsAppDatabase } from '../../src/db/app-database.js';
import { MIGRATION_FILES } from '../../src/db/migrate.js';
import type { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../database/migrations');
const TEST_FUNCTIONS_SQL = join(__dirname, '../../database/test-functions.sql');

let memDb: IMemoryDb | null = null;

/**
 * In-memory schema DB for unit/integration smoke tests.
 * pg-mem cannot run CREATE ROLE / FORCE RLS — those require real Postgres
 * (see test/integration/rls-roles.test.ts). Schema files applied here:
 * 001 + 005 + 006. Remaining migration versions (roles/grants/etc.) are
 * recorded only so isMigrationComplete() matches production for health checks.
 */
export function createTestDb(): { db: AppDatabase; pool: Pool; reset: () => Promise<void> } {
  memDb = newDb({ autoCreateForeignKeyIndices: true });

  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid' as never,
    impure: true,
    implementation: () => randomUUID(),
  });

  memDb.public.registerFunction({
    name: 'now',
    returns: 'timestamptz' as never,
    implementation: () => new Date(),
  });

  const schemaFiles = ['001_v2_schema.sql', '005_local_auth.sql', '006_email_identity.sql'];
  for (const file of schemaFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(
      /CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/gi,
      '',
    );
    memDb.public.none(sql);
  }

  const values = MIGRATION_FILES.map((file) => `('${file}')`).join(', ');
  memDb.public.none(`
    INSERT INTO schema_migrations (version) VALUES ${values}
    ON CONFLICT DO NOTHING;
  `);

  memDb.public.none(readFileSync(TEST_FUNCTIONS_SQL, 'utf8'));

  const { Pool: MemPool } = memDb.adapters.createPg();
  const pool = new MemPool();
  const db = wrapDbAsAppDatabase(createDbClient(pool));

  return {
    db,
    pool,
    reset: async () => {
      await db.close();
    },
  };
}
