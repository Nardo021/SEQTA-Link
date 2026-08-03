import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { applyMigrations, getAppliedMigrations, isMigrationComplete } from '../../src/db/migrate.js';
import { createTempDbPath, cleanupTempDb } from '../helpers/test-app.js';

describe('migrations', () => {
  const dbPath = createTempDbPath('seqta-migrate-');

  after(() => {
    cleanupTempDb(dbPath);
  });

  it('applies migrations idempotently', () => {
    const db = new Database(dbPath);
    try {
      const first = applyMigrations(db);
      assert.deepEqual(first, ['001_initial.sql']);

      const second = applyMigrations(db);
      assert.deepEqual(second, []);

      assert.ok(isMigrationComplete(db));
      assert.deepEqual(getAppliedMigrations(db), ['001_initial.sql']);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);

      assert.ok(tables.includes('feeds'));
      assert.ok(tables.includes('events'));
      assert.ok(tables.includes('event_aliases'));
      assert.ok(tables.includes('sync_runs'));
    } finally {
      db.close();
    }
  });
});
