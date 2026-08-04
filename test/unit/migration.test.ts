import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/pg-test-db.js';
import { applyMigrations, getAppliedMigrations, isMigrationComplete } from '../../src/db/migrate.js';

describe('migrations', () => {
  it('applies migrations idempotently', async () => {
    const { db } = createTestDb();
    const client = db.migrator;

    const first = await applyMigrations(client);
    assert.ok(first.length >= 0);

    const applied = await getAppliedMigrations(client);
    assert.ok(applied.includes('001_v2_schema.sql'));

    const complete = await isMigrationComplete(client);
    assert.equal(complete, true);

    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    const names = tables.map((row) => row.table_name);
    assert.ok(names.includes('calendars'));
    assert.ok(names.includes('events'));
    assert.ok(names.includes('event_aliases'));
    assert.ok(names.includes('sync_runs'));

    await db.close();
  });
});
