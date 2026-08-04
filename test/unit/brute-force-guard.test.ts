import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BruteForceGuard } from '../../src/security/brute-force-guard.js';
import { AppError } from '../../src/shared/errors.js';

describe('BruteForceGuard', () => {
  it('locks after max failures and unlocks after lockout', () => {
    let now = 1_000_000;
    const guard = new BruteForceGuard(() => now);
    const policy = { maxFailures: 3, windowMs: 60_000, lockoutMs: 30_000 };

    guard.recordFailure('login', 'a@example.com', policy);
    guard.recordFailure('login', 'a@example.com', policy);
    guard.assertAllowed('login', 'a@example.com');

    guard.recordFailure('login', 'a@example.com', policy);
    assert.throws(
      () => guard.assertAllowed('login', 'a@example.com'),
      (error: unknown) => error instanceof AppError && error.code === 'RATE_LIMITED',
    );

    now += 31_000;
    guard.assertAllowed('login', 'a@example.com');
  });

  it('clears failures on success', () => {
    const guard = new BruteForceGuard();
    const policy = { maxFailures: 2, windowMs: 60_000, lockoutMs: 30_000 };
    guard.recordFailure('login', 'b@example.com', policy);
    guard.recordSuccess('login', 'b@example.com');
    guard.recordFailure('login', 'b@example.com', policy);
    guard.assertAllowed('login', 'b@example.com');
  });
});
