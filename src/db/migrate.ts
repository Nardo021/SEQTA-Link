import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { loadConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export const MIGRATION_FILES = ['001_initial.sql'] as const;

export function applyMigrations(db: Database.Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    ) STRICT;
  `);

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: string }).version),
  );

  const newlyApplied: string[] = [];
  const now = new Date().toISOString();

  for (const file of MIGRATION_FILES) {
    if (applied.has(file)) {
      continue;
    }
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      file,
      now,
    );
    newlyApplied.push(file);
  }

  return newlyApplied;
}

export function getAppliedMigrations(db: Database.Database): string[] {
  const rows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: string }>;
  return rows.map((row) => row.version);
}

export function isMigrationComplete(db: Database.Database): boolean {
  const applied = new Set(getAppliedMigrations(db));
  return MIGRATION_FILES.every((file) => applied.has(file));
}

function runCli(): void {
  const config = loadConfig();
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  try {
    db.pragma('foreign_keys = ON');
    const applied = applyMigrations(db);
    if (applied.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Applied migrations: ${applied.join(', ')}`);
    }
  } finally {
    db.close();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  runCli();
}
