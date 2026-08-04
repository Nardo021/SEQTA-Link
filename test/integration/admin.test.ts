import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestApp, baseSyncPayload } from '../helpers/test-app.js';
import { createCalendarService } from '../../src/cli/db.js';

async function devLogin(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  displayName: string,
  role: 'owner' | 'admin' | 'user' = 'user',
) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/dev-login',
    payload: { displayName, role },
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies.find((c) => c.name === 'seqta_session');
  assert.ok(cookie?.value);
  return cookie.value;
}

describe('admin api', () => {
  it('forbids regular users from admin routes', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Regular User', 'user');
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { seqta_session: session },
    });
    assert.equal(response.statusCode, 403);
    await app.close();
  });

  it('owner can manage users and write audit logs', async () => {
    const { app } = await createTestApp();
    const ownerSession = await devLogin(app, 'Owner Admin', 'owner');
    const userSession = await devLogin(app, 'Managed User', 'user');

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: userSession },
    });
    const userId = (me.json() as { user: { id: string } }).user.id;

    const disableFeed = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable-feed`,
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(disableFeed.statusCode, 200);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(audit.statusCode, 200);
    const logs = (audit.json() as { logs: Array<{ action: string }> }).logs;
    assert.ok(logs.some((log) => log.action === 'user.disable_feed'));

    await app.close();
  });

  it('creates and lists invitations', async () => {
    const { app } = await createTestApp();
    const ownerSession = await devLogin(app, 'Invite Owner', 'owner');

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      cookies: { seqta_session: ownerSession },
      payload: { expectedName: 'New Student', note: 'Test invite' },
    });
    assert.equal(created.statusCode, 200);
    assert.match((created.json() as { inviteUrl: string }).inviteUrl, /invite\.html\?token=/);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/invitations',
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(listed.statusCode, 200);
    const invitations = (listed.json() as { invitations: unknown[] }).invitations;
    assert.ok(invitations.length >= 1);

    await app.close();
  });
});

describe('calendar client compatibility', () => {
  async function setupFeedWithEvent(app: Awaited<ReturnType<typeof createTestApp>>['app']) {
    const { config, db } = app as unknown as Awaited<ReturnType<typeof createTestApp>>;
    const feed = await createCalendarService(db.cli, config).createCalendar({
        name: 'Client Test Feed',
        schoolHost: 'learn.masada.onseqtacloud.com',
        studentRef: '6001',
        timezone: 'Australia/Sydney',
      });
    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({
        schoolHost: 'learn.masada.onseqtacloud.com',
        studentRef: '6001',
      }),
    });
    return feed;
  }

  it('serves RFC5545-compatible ICS for Apple/Google clients', async () => {
    const ctx = await createTestApp();
    const feed = await setupFeedWithEvent(ctx.app);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/calendar; charset=utf-8');

    const body = String(response.body);
    assert.ok(body.includes('\r\n'), 'ICS must use CRLF line endings');
    assert.match(body, /BEGIN:VCALENDAR/);
    assert.match(body, /VERSION:2\.0/);
    assert.match(body, /PRODID:/);
    assert.match(body, /BEGIN:VEVENT/);
    assert.match(body, /UID:[^\r\n]+/);
    assert.match(body, /DTSTART:/);
    assert.match(body, /DTEND:/);
    assert.match(body, /SUMMARY:/);
    assert.match(body, /DTSTAMP:/);
    assert.match(body, /SEQUENCE:/);
    assert.match(body, /STATUS:CONFIRMED/);
    assert.ok(response.headers.etag);

    await ctx.app.close();
  });

  it('returns 304 when ETag matches (client cache)', async () => {
    const ctx = await createTestApp();
    const feed = await setupFeedWithEvent(ctx.app);

    const first = await ctx.app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    const etag = first.headers.etag;
    const second = await ctx.app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
      headers: { 'if-none-match': String(etag) },
    });
    assert.equal(second.statusCode, 304);
    await ctx.app.close();
  });

  it('includes cancelled events with STATUS:CANCELLED', async () => {
    const ctx = await createTestApp();
    const feed = await setupFeedWithEvent(ctx.app);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${feed.uploadToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({
        schoolHost: 'learn.masada.onseqtacloud.com',
        studentRef: '6001',
        lessons: [],
        allowEmptySnapshot: true,
      }),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/calendar/${feed.calendarToken}.ics`,
    });
    assert.match(String(response.body), /STATUS:CANCELLED/);
    await ctx.app.close();
  });

  it('returns 410 when feed is disabled by administrator', async () => {
    const ctx = await createTestApp();
    const ownerSession = await devLogin(ctx.app, 'Feed Owner 410', 'owner');

    const pairing = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: ownerSession },
    });
    const { code } = pairing.json() as { code: string };
    const paired = await ctx.app.inject({
      method: 'POST',
      url: '/api/device/pair',
      payload: { code },
    });
    const { deviceToken } = paired.json() as { deviceToken: string };

    await ctx.app.inject({
      method: 'POST',
      url: '/api/device/sync',
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: '7001' }),
    });

    const rotated = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/calendar/rotate-token',
      cookies: { seqta_session: ownerSession },
    });
    const calendarUrl = (rotated.json() as { calendarUrl: string }).calendarUrl;
    const calendarToken = calendarUrl.split('/calendar/')[1]!.replace('.ics', '');

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: ownerSession },
    });
    const userId = (me.json() as { user: { id: string } }).user.id;

    await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/disable-feed`,
      cookies: { seqta_session: ownerSession },
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/calendar/${calendarToken}.ics`,
    });
    assert.equal(response.statusCode, 410);
    assert.match(String(response.body), /disabled by administrator/i);

    await ctx.app.close();
  });

  it('invalidates old calendar token after rotation', async () => {
    const ctx = await createTestApp();
    const ownerSession = await devLogin(ctx.app, 'Rotate Owner', 'owner');

    const pairing = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: ownerSession },
    });
    const { code } = pairing.json() as { code: string };
    const paired = await ctx.app.inject({
      method: 'POST',
      url: '/api/device/pair',
      payload: { code },
    });
    const { deviceToken } = paired.json() as { deviceToken: string };

    await ctx.app.inject({
      method: 'POST',
      url: '/api/device/sync',
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: '7002' }),
    });

    const firstRotate = await ctx.app.inject({
      method: 'POST',
      url: '/api/me/calendar/rotate-token',
      cookies: { seqta_session: ownerSession },
    });
    const oldToken = (firstRotate.json() as { calendarUrl: string }).calendarUrl
      .split('/calendar/')[1]!
      .replace('.ics', '');

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: ownerSession },
    });
    const userId = (me.json() as { user: { id: string } }).user.id;

    const secondRotate = await ctx.app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/rotate-calendar-token`,
      cookies: { seqta_session: ownerSession },
    });
    const newToken = (secondRotate.json() as { calendarUrl: string }).calendarUrl
      .split('/calendar/')[1]!
      .replace('.ics', '');

    const oldResponse = await ctx.app.inject({
      method: 'GET',
      url: `/calendar/${oldToken}.ics`,
    });
    assert.equal(oldResponse.statusCode, 404);

    const newResponse = await ctx.app.inject({
      method: 'GET',
      url: `/calendar/${newToken}.ics`,
    });
    assert.equal(newResponse.statusCode, 200);

    await ctx.app.close();
  });
});
