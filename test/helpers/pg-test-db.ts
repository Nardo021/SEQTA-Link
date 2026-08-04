import { randomUUID } from 'node:crypto';
import { newDb, type IMemoryDb } from 'pg-mem';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbClient, type AppDatabase } from '../../src/db/client.js';
import { wrapDbAsAppDatabase } from '../../src/db/app-database.js';
import type { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../../database/migrations');
const TEST_FUNCTIONS_SQL = join(__dirname, '../../database/test-functions.sql');

let memDb: IMemoryDb | null = null;

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

  const migrationFiles = ['001_v2_schema.sql'];
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(
      /CREATE EXTENSION IF NOT EXISTS pgcrypto;\s*/gi,
      '',
    );
    memDb.public.none(sql);
  }

  memDb.public.none(`
    INSERT INTO schema_migrations (version) VALUES
      ('001_v2_schema.sql'),
      ('002_rls_policies.sql'),
      ('003_db_roles.sql')
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

export async function applyTestMigrations(db: AppDatabase): Promise<void> {
  await db.exec(`
    INSERT INTO schema_migrations (version) VALUES ('001_v2_schema.sql'), ('002_rls_policies.sql'), ('003_db_roles.sql')
    ON CONFLICT DO NOTHING
  `);
}
