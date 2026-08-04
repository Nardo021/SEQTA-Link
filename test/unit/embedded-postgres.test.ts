import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEmbeddedDatabaseUrl,
  ensureEmbeddedPostgres,
} from '../../src/db/embedded-postgres.js';
import { createDbClient, createPool, ensureRoleGrants } from '../../src/db/client.js';
import { applyMigrations } from '../../src/db/migrate.js';

describe('embedded postgres', () => {
  it('starts a cluster, applies migrations, and restarts from the same data dir', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'seqta-epg-'));
    const options = {
      dataDir,
      port: 55440 + Math.floor(Math.random() * 100),
      user: 'seqta',
      password: 'seqta-test',
      database: 'seqta_calendar',
      createPostgresUser: false,
    };

    const first = await ensureEmbeddedPostgres(options);
    assert.equal(first.startedByUs, true);
    assert.equal(first.databaseUrl, buildEmbeddedDatabaseUrl(options));

    const pool = await createPool(first.databaseUrl);
    const db = createDbClient(pool);
    try {
      const applied = await applyMigrations(db);
      assert.ok(applied.length > 0);
      await ensureRoleGrants(db);
      const one = await db.queryOne<{ ok: number }>('SELECT 1 AS ok');
      assert.equal(one?.ok, 1);
    } finally {
      await db.close();
      await first.stop();
    }

    const second = await ensureEmbeddedPostgres(options);
    assert.equal(second.startedByUs, true);
    const pool2 = await createPool(second.databaseUrl);
    const db2 = createDbClient(pool2);
    try {
      const count = await db2.queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM schema_migrations`,
      );
      assert.ok(Number(count?.n ?? 0) >= 4);
    } finally {
      await db2.close();
      await second.stop();
    }
  });
});
