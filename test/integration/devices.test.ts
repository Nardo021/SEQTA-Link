import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestApp, baseSyncPayload } from '../helpers/test-app.js';

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

describe('devices and portal api', () => {
  it('pairs device and syncs via dvc_ token', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Portal User');

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
      payload: { code, deviceName: 'Test Browser' },
    });
    assert.equal(paired.statusCode, 200);
    const { deviceToken } = paired.json() as { deviceToken: string };
    assert.match(deviceToken, /^dvc_/);

    const sync = await app.inject({
      method: 'POST',
      url: '/api/device/sync',
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

  it('rejects device token on /api/me routes', async () => {
    const { app } = await createTestApp();
    const session = await devLogin(app, 'Me Guard User');
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
