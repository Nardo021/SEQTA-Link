import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import { testSecretsEnv } from '../../src/cli/db.js';

describe('config', () => {
  it('fails when TOKEN_PEPPER is missing', () => {
    assert.throws(
      () =>
        loadConfig({
          UID_SECRET: Buffer.alloc(32, 2).toString('base64'),
        }),
      /TOKEN_PEPPER/,
    );
  });

  it('fails when UID_SECRET is missing', () => {
    assert.throws(
      () =>
        loadConfig({
          TOKEN_PEPPER: Buffer.alloc(32, 1).toString('base64'),
        }),
      /UID_SECRET/,
    );
  });

  it('fails when secrets are identical', () => {
    const secret = Buffer.alloc(32, 1).toString('base64');
    assert.throws(
      () =>
        loadConfig({
          TOKEN_PEPPER: secret,
          UID_SECRET: secret,
        }),
      /must be different/,
    );
  });

  it('loads valid configuration', () => {
    const config = loadConfig(testSecretsEnv());
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3210);
    assert.equal(config.defaultTimezone, 'Australia/Sydney');
  });
});
