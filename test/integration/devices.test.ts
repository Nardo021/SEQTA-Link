import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestApp, baseSyncPayload } from '../helpers/test-app.js';
import { bootstrapOwner } from '../../src/modules/auth/owner-bootstrap.js';
import { createTokenService } from '../../src/security/token.service.js';

async function devLogin(app: Awaited<ReturnType<typeof createTestApp>>['app'], displayName: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/dev-login',
    payload: { displayName },
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.cookies.find((c) => c.name === 'seqta_session');
  assert.ok(cookie?.value);
  return cookie.value;
}

async function pairBrowser(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  session: string,
  deviceName = 'Test Browser',
) {
  const pairing = await app.inject({
    method: 'POST',
    url: '/api/me/pairing-codes',
    cookies: { seqta_session: session },
  });
  assert.equal(pairing.statusCode, 200);
  const { code } = pairing.json() as { code: string };
  const paired = await app.inject({
    method: 'POST',
    url: '/api/device/pair',
    payload: { code, deviceName },
  });
  assert.equal(paired.statusCode, 200);
  return paired.json() as { deviceToken: string; deviceId: string; calendarLabel: string };
}

describe('devices and portal api', () => {
  it('pairs device and syncs via dvc_ token', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Portal User');
    const { deviceToken } = await pairBrowser(app, session);

    const sync = await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: '5555' }),
    });
    assert.equal(sync.statusCode, 200);

    const devices = await app.inject({
      method: 'GET',
      url: '/api/me/devices',
      cookies: { seqta_session: session },
    });
    assert.equal(devices.statusCode, 200);
    const body = devices.json() as { devices: Array<{ status: string }> };
    assert.equal(body.devices.length, 1);
    assert.equal(body.devices[0]?.status, 'active');

    await app.close();
  });

  it('returns device status for paired dvc_ token', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Status User');
    const { deviceToken } = await pairBrowser(app, session, 'Status Browser');

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/status',
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(status.statusCode, 200);
    const body = status.json() as {
      feed: { name: string };
      device: { name: string };
      events: { active: number; cancelled: number };
    };
    assert.ok(body.feed.name);
    assert.equal(body.device.name, 'Status Browser');
    assert.equal(typeof body.events.active, 'number');

    await app.close();
  });

  it('lists and cancels pending pairing codes', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Pairing List User');

    const created = await app.inject({
      method: 'POST',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: session },
    });
    assert.equal(created.statusCode, 200);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: session },
    });
    assert.equal(listed.statusCode, 200);
    const codes = (listed.json() as { codes: Array<{ id: string }> }).codes;
    assert.equal(codes.length, 1);

    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/me/pairing-codes/${codes[0]!.id}`,
      cookies: { seqta_session: session },
    });
    assert.equal(cancelled.statusCode, 200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/me/pairing-codes',
      cookies: { seqta_session: session },
    });
    assert.equal((after.json() as { codes: unknown[] }).codes.length, 0);

    await app.close();
  });

  it('changes password and requires re-login', async () => {
    const { app, config, db } = await createTestApp();
    const email = `pwd-${Date.now()}@example.com`;
    const password = 'old-password-1';
    await bootstrapOwner(db.cli, config, createTokenService(config), email, password);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200);
    const session = login.cookies.find((c) => c.name === 'seqta_session')?.value;
    assert.ok(session);

    const changed = await app.inject({
      method: 'POST',
      url: '/api/me/password',
      cookies: { seqta_session: session },
      payload: { currentPassword: password, newPassword: 'new-password-1' },
    });
    assert.equal(changed.statusCode, 200);

    const stale = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: session },
    });
    assert.equal(stale.statusCode, 401);

    const again = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'new-password-1' },
    });
    assert.equal(again.statusCode, 200);

    await app.close();
  });

  it('returns enriched sync history after device sync', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'History User');
    const { deviceToken } = await pairBrowser(app, session, 'History Browser');

    const sync = await app.inject({
      method: 'POST',
      url: '/api/v1/sync',
      headers: {
        authorization: `Bearer ${deviceToken}`,
        'idempotency-key': randomUUID(),
      },
      payload: baseSyncPayload({ studentRef: '7777' }),
    });
    assert.equal(sync.statusCode, 200);

    const history = await app.inject({
      method: 'GET',
      url: '/api/me/sync-runs',
      cookies: { seqta_session: session },
    });
    assert.equal(history.statusCode, 200);
    const runs = (history.json() as { runs: Array<{ deviceName: string | null; status: string }> }).runs;
    assert.ok(runs.length >= 1);
    assert.equal(runs[0]?.deviceName, 'History Browser');
    assert.equal(runs[0]?.status, 'success');

    await app.close();
  });

  it('rejects device token on /api/me routes', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Me Guard User');
    const { deviceToken } = await pairBrowser(app, session);

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    assert.equal(response.statusCode, 401);
    await app.close();
  });

  it('returns dashboard for authenticated session', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Dashboard User');
    const response = await app.inject({
      method: 'GET',
      url: '/api/me/dashboard',
      cookies: { seqta_session: session },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { account: { displayName: string } };
    assert.equal(body.account.displayName, 'Dashboard User');
    await app.close();
  });
});
