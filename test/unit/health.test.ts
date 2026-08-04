import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp } from '../helpers/test-app.js';

describe('health routes', () => {
  it('returns ok for live probe', async () => {
    const { app } = await createTestApp();

    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });

    await app.close();
  });

  it('returns ready when dependencies are healthy', async () => {
    const { app } = await createTestApp();

    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { status: string; checks: Record<string, boolean> };
    assert.equal(body.status, 'ok');
    assert.equal(body.checks.postgres, true);
    assert.equal(body.checks.migrations, true);
    assert.equal(body.checks.uidSecretLoaded, true);

    await app.close();
  });
});
