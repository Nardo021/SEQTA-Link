import { AppError } from '../shared/errors.js';

export interface BruteForcePolicy {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

interface Bucket {
  failures: number[];
  lockedUntil: number;
}

/** In-memory sliding-window failure tracker + lockout (single-process). */
export class BruteForceGuard {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  assertAllowed(scope: string, key: string): void {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return;
    }
    this.prune();
    const id = bucketKey(scope, normalized);
    const bucket = this.buckets.get(id);
    if (!bucket) {
      return;
    }
    const now = this.now();
    if (bucket.lockedUntil > 0 && bucket.lockedUntil <= now) {
      this.buckets.delete(id);
      return;
    }
    if (bucket.lockedUntil > now) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000));
      throw new AppError(
        'RATE_LIMITED',
        `Too many attempts. Try again in ${retryAfterSec} seconds.`,
        429,
        { retryAfterSec, scope },
      );
    }
  }

  recordFailure(scope: string, key: string, policy: BruteForcePolicy): void {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return;
    }
    const id = bucketKey(scope, normalized);
    const now = this.now();
    const bucket = this.buckets.get(id) ?? { failures: [], lockedUntil: 0 };
    const cutoff = now - policy.windowMs;
    bucket.failures = bucket.failures.filter((ts) => ts >= cutoff);
    bucket.failures.push(now);
    if (bucket.failures.length >= policy.maxFailures) {
      bucket.lockedUntil = now + policy.lockoutMs;
    }
    this.buckets.set(id, bucket);
  }

  recordSuccess(scope: string, key: string): void {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return;
    }
    this.buckets.delete(bucketKey(scope, normalized));
  }

  private prune(): void {
    if (this.buckets.size < 5_000) {
      return;
    }
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.lockedUntil < now && bucket.failures.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}

function bucketKey(scope: string, key: string): string {
  return `${scope}:${key}`;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

export async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
