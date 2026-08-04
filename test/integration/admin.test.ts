import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestApp, baseSyncPayload } from '../helpers/test-app.js';

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

async function userIdForSession(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  session: string,
) {
  const me = await app.inject({
    method: 'GET',
    url: '/api/me',
    cookies: { seqta_session: session },
  });
  assert.equal(me.statusCode, 200);
  return (me.json() as { user: { id: string; displayName: string } }).user;
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

  it('owner can manage users and write audit logs with requestId', async () => {
    const { app } = await createTestApp();
    const ownerSession = await devLogin(app, 'Owner Admin', 'owner');
    const userSession = await devLogin(app, 'Managed User', 'user');
    const { id: userId } = await userIdForSession(app, userSession);

    const disableFeed = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${userId}`,
      cookies: { seqta_session: ownerSession },
      headers: { 'x-request-id': 'audit-req-1' },
      payload: { feedEnabled: false },
    });
    assert.equal(disableFeed.statusCode, 200);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs',
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(audit.statusCode, 200);
    const logs = (
      audit.json() as {
        logs: Array<{ action: string; requestId: string | null; actorDisplayName: string | null }>;
      }
    ).logs;
    const entry = logs.find((log) => log.action === 'user.disable_feed');
    assert.ok(entry);
    assert.equal(entry.requestId, 'audit-req-1');
    assert.ok(entry.actorDisplayName);

    await app.close();
  });

  it('supports patch, suspend, sync-runs, devices, revoke, and reset-source-identity', async () => {
    const { app } = await createTestApp();
    const ownerSession = await devLogin(app, 'Ops Owner', 'owner');
    const userSession = await devLogin(app, 'Target Student', 'user');
    const user = await userIdForSession(app, userSession);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${user.id}`,
      cookies: { seqta_session: ownerSession },
      payload: { displayName: 'Renamed Student', maxDevices: 5 },
    });
    assert.equal(patched.statusCode, 200);
    assert.equal((patched.json() as { user: { displayName: string; maxDevices: number } }).user.displayName, 'Renamed Student');
    assert.equal((patched.json() as { user: { maxDevices: number } }).user.maxDevices, 5);

    const pairing = await app.inject({
      method: 'POST',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: userSession },
    });
    const { code } = pairing.json() as { code: string };
    const paired = await app.inject({
      method: 'POST',
      url: '/api/device/pair',
      payload: { code, deviceName: 'Admin Test Browser' },
    });
    assert.equal(paired.statusCode, 200);
    const { deviceToken, deviceId } = paired.json() as { deviceToken: string; deviceId: string };

    await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: '8801' }),
    });

    const devices = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${user.id}/devices`,
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(devices.statusCode, 200);
    assert.equal((devices.json() as { devices: unknown[] }).devices.length, 1);

    const syncRuns = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${user.id}/sync-runs`,
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(syncRuns.statusCode, 200);
    const runs = (syncRuns.json() as { runs: Array<{ deviceName: string | null }> }).runs;
    assert.ok(runs.length >= 1);
    assert.equal(runs[0]?.deviceName, 'Admin Test Browser');

    const timetable = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${user.id}/timetable`,
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(timetable.statusCode, 200);
    assert.ok(Array.isArray((timetable.json() as { events: unknown[] }).events));

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/admin/devices/${deviceId}/revoke`,
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(revoked.statusCode, 200);

    const reset = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/reset-source-identity`,
      cookies: { seqta_session: ownerSession },
      payload: { confirmName: 'Renamed Student' },
    });
    assert.equal(reset.statusCode, 200);

    const suspended = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${user.id}/suspend`,
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(suspended.statusCode, 200);

    const meAfter = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: userSession },
    });
    assert.equal(meAfter.statusCode, 401);

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/admin/audit-logs?action=user.suspend',
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(filtered.statusCode, 200);
    assert.ok(
      (filtered.json() as { logs: Array<{ action: string }> }).logs.every(
        (log) => log.action === 'user.suspend',
      ),
    );

    await app.close();
  });

  it('creates and lists invitations with options', async () => {
    const { app } = await createTestApp();
    const ownerSession = await devLogin(app, 'Invite Owner', 'owner');

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      cookies: { seqta_session: ownerSession },
      payload: {
        expectedName: 'New Student',
        note: 'Test invite',
        maxDevices: 2,
        expiresInHours: 24,
        syncEnabled: true,
        feedEnabled: false,
      },
    });
    assert.equal(created.statusCode, 200);
    assert.match((created.json() as { inviteUrl: string }).inviteUrl, /invite\.html\?token=/);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/admin/invitations',
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(listed.statusCode, 200);
    const invitations = (
      listed.json() as { invitations: Array<{ maxDevices: number; feedEnabled: boolean }> }
    ).invitations;
    assert.ok(invitations.some((inv) => inv.maxDevices === 2 && inv.feedEnabled === false));

    await app.close();
  });

  it('dashboard includes recent audit', async () => {
    const { app } = await createTestApp();
    const ownerSession = await devLogin(app, 'Dash Owner', 'owner');
    const dash = await app.inject({
      method: 'GET',
      url: '/api/admin/dashboard',
      cookies: { seqta_session: ownerSession },
    });
    assert.equal(dash.statusCode, 200);
    const body = dash.json() as { recentAudit: unknown[]; users: { total: number } };
    assert.ok(Array.isArray(body.recentAudit));
    assert.ok(body.users.total >= 1);
    await app.close();
  });
});
