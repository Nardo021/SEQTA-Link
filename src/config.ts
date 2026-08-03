import { existsSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  databasePath: string;
  defaultTimezone: string;
  publicBaseUrl: string;
  tokenPepper: Buffer;
  uidSecret: Buffer;
  allowedOrigins: string[];
  maxBodyBytes: number;
  maxLessonsPerSync: number;
  maxSyncRangeDays: number;
  cancelledFeedRetentionDays: number;
  deletedDatabaseRetentionDays: number;
  logLevel: string;
  trustProxy: boolean;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBase64Secret(env: NodeJS.ProcessEnv, name: string, minBytes = 32): Buffer {
  const raw = requireEnv(env, name);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new Error(`${name} must be a valid base64-encoded secret`);
  }
  if (decoded.length < minBytes) {
    throw new Error(`${name} must decode to at least ${minBytes} bytes`);
  }
  return decoded;
}

function parseIntEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a valid integer`);
  }
  return parsed;
}

function parseBoolEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }
  return raw === 'true' || raw === '1';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const tokenPepper = parseBase64Secret(env, 'TOKEN_PEPPER');
  const uidSecret = parseBase64Secret(env, 'UID_SECRET');

  if (tokenPepper.equals(uidSecret)) {
    throw new Error('TOKEN_PEPPER and UID_SECRET must be different values');
  }

  const allowedOriginsRaw = env.ALLOWED_ORIGINS ?? '';
  const allowedOrigins = allowedOriginsRaw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const defaultTimezone = env.DEFAULT_TIMEZONE ?? 'Australia/Sydney';
  if (defaultTimezone !== 'Australia/Sydney') {
    throw new Error('Only Australia/Sydney timezone is supported in v1');
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '127.0.0.1',
    port: parseIntEnv(env, 'PORT', 3210),
    databasePath: env.DATABASE_PATH ?? './data/calendar.sqlite',
    defaultTimezone,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? 'https://timetable.leoze.top',
    tokenPepper,
    uidSecret,
    allowedOrigins,
    maxBodyBytes: parseIntEnv(env, 'MAX_BODY_BYTES', 2 * 1024 * 1024),
    maxLessonsPerSync: parseIntEnv(env, 'MAX_LESSONS_PER_SYNC', 2000),
    maxSyncRangeDays: parseIntEnv(env, 'MAX_SYNC_RANGE_DAYS', 120),
    cancelledFeedRetentionDays: parseIntEnv(env, 'CANCELLED_FEED_RETENTION_DAYS', 14),
    deletedDatabaseRetentionDays: parseIntEnv(env, 'DELETED_DATABASE_RETENTION_DAYS', 90),
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: parseBoolEnv(env, 'TRUST_PROXY', true),
  };
}

export function validateDataDirectoryWritable(databasePath: string): boolean {
  const dir = dirname(databasePath);
  try {
    if (!existsSync(dir)) {
      return false;
    }
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
