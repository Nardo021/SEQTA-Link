import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from '../helpers/test-app.js';
import {
  bootstrapOwner,
  ensureOwnerBootstrapFromConfig,
} from '../../src/modules/auth/owner-bootstrap.js';
import { createTokenService } from '../../src/security/token.service.js';

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

describe('local auth and invitations', () => {
  it('rejects password login without an account', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', password: 'password123' },
    });
    assert.equal(response.statusCode, 401);
    await app.close();
  });

  it('locks login after repeated failures', async () => {
    const prevMax = process.env.AUTH_LOGIN_MAX_FAILURES;
    const prevLock = process.env.AUTH_LOGIN_LOCKOUT_MINUTES;
    process.env.AUTH_LOGIN_MAX_FAILURES = '3';
    process.env.AUTH_LOGIN_LOCKOUT_MINUTES = '15';
    try {
      const { app } = await createTestApp();
      const email = `lockout-${Date.now()}@example.com`;
      for (let i = 0; i < 3; i += 1) {
        const failed = await app.inject({
          method: 'POST',
          url: '/auth/login',
          payload: { email, password: 'wrong-password' },
        });
        assert.equal(failed.statusCode, 401);
      }
      const locked = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password: 'wrong-password' },
      });
      assert.equal(locked.statusCode, 429);
      assert.equal((locked.json() as { error: { code: string } }).error.code, 'RATE_LIMITED');
      assert.ok(locked.headers['retry-after']);
      await app.close();
    } finally {
      if (prevMax === undefined) {
        delete process.env.AUTH_LOGIN_MAX_FAILURES;
      } else {
        process.env.AUTH_LOGIN_MAX_FAILURES = prevMax;
      }
      if (prevLock === undefined) {
        delete process.env.AUTH_LOGIN_LOCKOUT_MINUTES;
      } else {
        process.env.AUTH_LOGIN_LOCKOUT_MINUTES = prevLock;
      }
    }
  });

  it('registers via invitation with self-set password then logs in', async () => {
    const { app } = await createTestApp();
    const ownerSession = await devLogin(app, 'Invite Owner', 'owner');

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      cookies: { seqta_session: ownerSession },
      payload: { expectedName: 'New Student' },
    });
    assert.equal(created.statusCode, 200);
    const inviteUrl = (created.json() as { inviteUrl: string }).inviteUrl;
    const token = new URL(inviteUrl).searchParams.get('token');
    assert.ok(token);

    const email = `student-${Date.now()}@example.com`;
    const password = 'student-pass-1';

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/invite/${token}/accept`,
      payload: { email, password, displayName: 'New Student' },
    });
    assert.equal(accepted.statusCode, 200);
    const acceptCookie = accepted.cookies.find((c) => c.name === 'seqta_session');
    assert.ok(acceptCookie?.value);

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: acceptCookie.value },
    });
    assert.equal(me.statusCode, 200);
    const meUser = (me.json() as { user: { email: string; role: string } }).user;
    assert.equal(meUser.email, email);
    assert.equal(meUser.role, 'user');

    const reused = await app.inject({
      method: 'POST',
      url: `/api/invite/${token}/accept`,
      payload: { email: 'other@example.com', password: 'other-pass-1' },
    });
    assert.equal(reused.statusCode, 404);

    await app.inject({ method: 'POST', url: '/auth/logout', cookies: { seqta_session: acceptCookie.value } });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200);
    assert.ok(login.cookies.find((c) => c.name === 'seqta_session')?.value);

    const openRegister = await app.inject({
      method: 'POST',
      url: '/api/invite/not-a-real-token/accept',
      payload: { email: 'open@example.com', password: 'password123' },
    });
    assert.equal(openRegister.statusCode, 404);

    await app.close();
  });

  it('bootstraps owner only when no owner exists and does not auto-promote on login', async () => {
    const { app, config, db } = await createTestApp();
    const tokenService = createTokenService(config);
    const email = `owner-${Date.now()}@example.com`;
    const password = 'owner-secret-1';
    const owner = await bootstrapOwner(db.cli, config, tokenService, email, password);
    assert.equal(owner.role, 'owner');

    const again = await ensureOwnerBootstrapFromConfig(db.cli, config, tokenService);
    assert.equal(again, null);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    assert.equal(login.statusCode, 200);

    // Invite-register with same domain email stays user — no allowlist promote.
    const ownerSession = login.cookies.find((c) => c.name === 'seqta_session')?.value;
    assert.ok(ownerSession);
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/invitations',
      cookies: { seqta_session: ownerSession },
      payload: { expectedName: 'Peer' },
    });
    const token = new URL((created.json() as { inviteUrl: string }).inviteUrl).searchParams.get('token');
    assert.ok(token);
    const peerEmail = `peer-${Date.now()}@example.com`;
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/invite/${token}/accept`,
      payload: { email: peerEmail, password: 'peer-pass-1' },
    });
    assert.equal(accepted.statusCode, 200);
    const peerSession = accepted.cookies.find((c) => c.name === 'seqta_session')?.value;
    assert.ok(peerSession);
    const peerMe = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { seqta_session: peerSession },
    });
    assert.equal((peerMe.json() as { user: { role: string } }).user.role, 'user');
    const adminDenied = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { seqta_session: peerSession },
    });
    assert.equal(adminDenied.statusCode, 403);

    await app.close();
  });
});
