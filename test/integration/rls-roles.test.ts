import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, baseSyncPayload, isUsingRealPostgres } from '../helpers/test-app.js';
import { createTestFeed } from '../../src/cli/db.js';
import { randomUUID } from 'node:crypto';

describe('RLS and DB roles', () => {
  it('device role cannot read events without user context', async (t) => {
    if (!(await isUsingRealPostgres())) {
      t.skip('Requires real PostgreSQL (set DATABASE_URL_TEST)');
      return;
    }
    const { app, config, db } = await createTestApp();

    const feed = await createTestFeed(db.cli, config, {
      name: 'RLS A',
      schoolHost: 'learn.masada.onseqtacloud.com',
      studentRef: '1001',
      timezone: 'Australia/Sydney',
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      payload: baseSyncPayload({ studentRef: '1001' }),
    });

    const bare = await db.device.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM events',
    );
    assert.equal(Number(bare[0]?.count ?? 0), 0);

    const scoped = await db.device.withUserContext(feed.calendar.ownerUserId, (client) =>
      client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM events'),
    );
    assert.equal(Number(scoped[0]?.count ?? 0), 1);

    await app.close();
  });

  it('user A upload token cannot mutate user B calendar via API', async (t) => {
    if (!(await isUsingRealPostgres())) {
      t.skip('Requires real PostgreSQL (set DATABASE_URL_TEST)');
      return;
    }
    const { app, config, db } = await createTestApp();

    const a = await createTestFeed(db.cli, config, {
      name: 'User A',
      schoolHost: 'learn.masada.onseqtacloud.com',
      studentRef: '2001',
      timezone: 'Australia/Sydney',
    });
    const b = await createTestFeed(db.cli, config, {
      name: 'User B',
      schoolHost: 'learn.masada.onseqtacloud.com',
      studentRef: '2002',
      timezone: 'Australia/Sydney',
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${a.uploadToken}`,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      payload: baseSyncPayload({ studentRef: '2001' }),
    });

    const statusB = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: { authorization: `Bearer ${b.uploadToken}` },
    });
    assert.equal(statusB.statusCode, 200);
    const body = statusB.json() as { events: { active: number } };
    assert.equal(body.events.active, 0);

    const statusA = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: { authorization: `Bearer ${a.uploadToken}` },
    });
    const bodyA = statusA.json() as { events: { active: number } };
    assert.equal(bodyA.events.active, 1);

    await app.close();
  });

  it('sync_enabled=false blocks upload sync with 403', async (t) => {
    if (!(await isUsingRealPostgres())) {
      t.skip('Requires real PostgreSQL (set DATABASE_URL_TEST)');
      return;
    }
    const { app, config, db } = await createTestApp();
    const feed = await createTestFeed(db.cli, config, {
      name: 'Disabled Sync',
      schoolHost: 'learn.masada.onseqtacloud.com',
      studentRef: '3001',
      timezone: 'Australia/Sydney',
    });

    await db.admin.exec('UPDATE users SET sync_enabled = false WHERE id = $1', [
      feed.calendar.ownerUserId,
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      payload: baseSyncPayload({ studentRef: '3001' }),
    });
    assert.equal(response.statusCode, 403);
    assert.equal((response.json() as { error: { code: string } }).error.code, 'SYNC_DISABLED');

    await app.close();
  });

  it('feed_enabled=false returns 410 for calendar URL', async (t) => {
    if (!(await isUsingRealPostgres())) {
      t.skip('Requires real PostgreSQL (set DATABASE_URL_TEST)');
      return;
    }
    const { app, config, db } = await createTestApp();
    const feed = await createTestFeed(db.cli, config, {
      name: 'Disabled Feed',
      schoolHost: 'learn.masada.onseqtacloud.com',
      studentRef: '3002',
      timezone: 'Australia/Sydney',
    });

    await db.admin.exec('UPDATE users SET feed_enabled = false WHERE id = $1', [
      feed.calendar.ownerUserId,
    ]);

    const response = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    assert.equal(response.statusCode, 410);

    await app.close();
  });
});
