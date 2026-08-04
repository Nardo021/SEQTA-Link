import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPasswordPolicy,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from '../../src/shared/password.js';

describe('password helpers', () => {
  it('normalizes email', () => {
    assert.equal(normalizeEmail('  Yanze.Shi@Outlook.com '), 'yanze.shi@outlook.com');
  });

  it('hashes and verifies passwords', () => {
    const hash = hashPassword('correct-horse');
    assert.ok(hash.startsWith('scrypt$'));
    assert.equal(verifyPassword('correct-horse', hash), true);
    assert.equal(verifyPassword('wrong-password', hash), false);
  });

  it('enforces minimum length', () => {
    assert.throws(() => assertPasswordPolicy('short'), /at least 8/);
  });
});
