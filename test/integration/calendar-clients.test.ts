import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestApp, baseSyncPayload } from '../helpers/test-app.js';
import { createTestFeed } from '../../src/cli/db.js';

async function createSyncedFeed(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  config: Awaited<ReturnType<typeof createTestApp>>['config'],
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  studentRef: string,
  name = 'Client Feed',
) {
  const feed = await createTestFeed(db.cli, config, {
    name,
    schoolHost: 'learn.masada.onseqtacloud.com',
    studentRef,
    timezone: 'Australia/Sydney',
  });
  const sync = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: {
      authorization: `Bearer ${feed.uploadToken}`,
      'idempotency-key': randomUUID(),
    },
    payload: baseSyncPayload({
      schoolHost: 'learn.masada.onseqtacloud.com',
      studentRef,
    }),
  });
  assert.equal(sync.statusCode, 200);
  return feed;
}

describe('Phase 6 calendar client compatibility', () => {
  it('serves Apple/Google-compatible RFC5545 ICS headers and body', async () => {
    const { app, config, db } = await createTestApp();
    const feed = await createSyncedFeed(app, config, db, '6101', 'Leo Timetable');

    const response = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/calendar; charset=utf-8');
    assert.equal(response.headers['cache-control'], 'private, no-cache, max-age=0, must-revalidate');
    assert.match(String(response.headers.etag), /^"calendar-\d+"$/);
    assert.ok(response.headers['last-modified']);

    const body = String(response.body);
    assert.ok(body.includes('\r\n'), 'ICS must use CRLF');
    assert.match(body, /BEGIN:VCALENDAR/);
    assert.match(body, /VERSION:2\.0/);
    assert.match(body, /METHOD:PUBLISH/);
    assert.match(body, /X-WR-CALNAME:Leo Timetable/);
    assert.match(body, /X-WR-TIMEZONE:Australia\/Sydney/);
    assert.match(body, /BEGIN:VEVENT/);
    assert.match(body, /UID:[^\r\n]+@timetable\.leoze\.top/);
    assert.match(body, /DTSTART:/);
    assert.match(body, /DTEND:/);
    assert.match(body, /DTSTAMP:/);
    assert.match(body, /LAST-MODIFIED:/);
    assert.match(body, /SEQUENCE:\d+/);
    assert.match(body, /STATUS:CONFIRMED/);
    assert.doesNotMatch(body, /6101/);
    assert.doesNotMatch(body, /student/i);

    await app.close();
  });

  it('supports ETag / 304 for Apple and Google polling', async () => {
    const { app, config, db } = await createTestApp();
    const feed = await createSyncedFeed(app, config, db, '6102');

    const first = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    const etag = String(first.headers.etag);
    assert.match(etag, /^"calendar-\d+"$/);

    const strong = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
      headers: { 'if-none-match': etag },
    });
    assert.equal(strong.statusCode, 304);

    const weak = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
      headers: { 'if-none-match': `W/${etag}` },
    });
    assert.equal(weak.statusCode, 304);

    await app.close();
  });

  it('keeps stable UID and bumps SEQUENCE when lesson content changes', async () => {
    const { app, config, db } = await createTestApp();
    const feed = await createSyncedFeed(app, config, db, '6103');

    const first = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    const firstBody = String(first.body);
    const uid = firstBody.match(/UID:([^\r\n]+)/)?.[1];
    const sequence = Number(firstBody.match(/SEQUENCE:(\d+)/)?.[1]);
    assert.ok(uid);
    assert.ok(Number.isFinite(sequence));

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({
        schoolHost: 'learn.masada.onseqtacloud.com',
        studentRef: '6103',
        lessons: [
          {
            ...baseSyncPayload().lessons[0]!,
            teacher: 'Ms Updated',
            room: 'M999',
          },
        ],
      }),
    });

    const second = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    const secondBody = String(second.body);
    assert.notEqual(second.headers.etag, first.headers.etag);
    assert.ok(secondBody.includes(`UID:${uid}`));
    const nextSequence = Number(secondBody.match(/SEQUENCE:(\d+)/)?.[1]);
    assert.ok(nextSequence > sequence);

    await app.close();
  });

  it('includes STATUS:CANCELLED for cancelled lessons (retention window)', async () => {
    const { app, config, db } = await createTestApp();
    const feed = await createSyncedFeed(app, config, db, '6104');

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({
        schoolHost: 'learn.masada.onseqtacloud.com',
        studentRef: '6104',
        lessons: [],
        allowEmptySnapshot: true,
      }),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.body), /STATUS:CANCELLED/);

    await app.close();
  });

  it('returns 410 Gone when feed is disabled (not empty ICS)', async () => {
    const { app } = await createTestApp();
    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/auth/dev-login',
      payload: { displayName: 'Feed Disable Owner', role: 'owner' },
    });
    const session = ownerLogin.cookies.find((c) => c.name === 'seqta_session')?.value;
    assert.ok(session);

    const pairing = await app.inject({
      method: 'POST',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: session },
    });
    const { code } = pairing.json() as { code: string };
    const paired = await app.inject({
      method: 'POST',
      url: '/api/device/pair',
      payload: { code },
    });
    const { deviceToken } = paired.json() as { deviceToken: string };

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: '6105' }),
    });

    const rotated = await app.inject({
      method: 'POST',
      url: '/api/me/calendar/rotate-token',
      cookies: { seqta_session: session },
    });
    const calendarUrl = (rotated.json() as { calendarUrl: string }).calendarUrl;
    const calendarToken = calendarUrl.split('/calendar/')[1]!.replace('.ics', '');

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: session },
    });
    const userId = (me.json() as { user: { id: string } }).user.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${userId}`,
      payload: { feedEnabled: false },
      cookies: { seqta_session: session },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/calendar/${calendarToken}.ics`,
    });
    assert.equal(response.statusCode, 410);
    assert.match(String(response.body), /disabled by administrator/i);
    assert.doesNotMatch(String(response.body), /BEGIN:VCALENDAR/);

    await app.close();
  });

  it('invalidates previous calendar URL after token rotation', async () => {
    const { app } = await createTestApp();
    const ownerLogin = await app.inject({
      method: 'POST',
      url: '/auth/dev-login',
      payload: { displayName: 'Rotate Client Owner', role: 'owner' },
    });
    const session = ownerLogin.cookies.find((c) => c.name === 'seqta_session')?.value;
    assert.ok(session);

    const pairing = await app.inject({
      method: 'POST',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: session },
    });
    const { code } = pairing.json() as { code: string };
    const paired = await app.inject({
      method: 'POST',
      url: '/api/device/pair',
      payload: { code },
    });
    const { deviceToken } = paired.json() as { deviceToken: string };

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: '6106' }),
    });

    const firstRotate = await app.inject({
      method: 'POST',
      url: '/api/me/calendar/rotate-token',
      cookies: { seqta_session: session },
    });
    const oldToken = (firstRotate.json() as { calendarUrl: string }).calendarUrl
      .split('/calendar/')[1]!
      .replace('.ics', '');

    const secondRotate = await app.inject({
      method: 'POST',
      url: '/api/me/calendar/rotate-token',
      cookies: { seqta_session: session },
    });
    const newToken = (secondRotate.json() as { calendarUrl: string }).calendarUrl
      .split('/calendar/')[1]!
      .replace('.ics', '');

    assert.equal(
      (await app.inject({ method: 'GET', url: `/calendar/${oldToken}.ics` })).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ method: 'GET', url: `/calendar/${newToken}.ics` })).statusCode,
      200,
    );

    await app.close();
  });
});
