import { AppError } from '../shared/errors.js';
import {
  BruteForceGuard,
  delayMs,
  type BruteForcePolicy,
} from './brute-force-guard.js';

export interface BruteForceKey {
  scope: string;
  key: string;
}

export function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof AppError &&
    (error.code === 'INVALID_TOKEN' || error.code === 'UNAUTHORIZED')
  );
}

export function isNotFound(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 404;
}

export function isUnauthorizedStatus(error: unknown): boolean {
  return error instanceof AppError && error.statusCode === 401;
}

export async function withBruteForce<T>(
  guard: BruteForceGuard,
  policy: BruteForcePolicy,
  keys: BruteForceKey[],
  options: {
    run: () => Promise<T>;
    shouldRecordFailure?: (error: unknown) => boolean;
    delayOnFailureMs?: number;
    clearOnSuccess?: boolean;
  },
): Promise<T> {
  for (const { scope, key } of keys) {
    guard.assertAllowed(scope, key);
  }

  try {
    const result = await options.run();
    if (options.clearOnSuccess !== false) {
      for (const { scope, key } of keys) {
        guard.recordSuccess(scope, key);
      }
    }
    return result;
  } catch (error) {
    const shouldRecord =
      options.shouldRecordFailure?.(error) ??
      (error instanceof AppError && (error.statusCode === 401 || error.statusCode === 404));
    if (shouldRecord) {
      for (const { scope, key } of keys) {
        guard.recordFailure(scope, key, policy);
      }
      if (options.delayOnFailureMs && options.delayOnFailureMs > 0) {
        await delayMs(options.delayOnFailureMs);
      }
    }
    throw error;
  }
}
