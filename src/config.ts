import dotenv from 'dotenv';
import type { EmbeddedPostgresOptions } from './db/embedded-postgres.js';

dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  embeddedPg: boolean;
  embeddedPostgres: EmbeddedPostgresOptions;
  defaultTimezone: string;
  publicBaseUrl: string;
  tokenPepper: Buffer;
  uidSecret: Buffer;
  allowedOrigins: string[];
  maxBodyBytes: number;
  maxLessonsPerSync: number;
  maxSyncRangeDays: number;
  cancelledFeedRetentionDays: number;
  logLevel: string;
  trustProxy: boolean;
  sessionSecret: Buffer;
  sessionTtlHours: number;
  cookieSecure: boolean;
  authDevLoginEnabled: boolean;
  ownerBootstrapEmail?: string;
  ownerBootstrapPassword?: string;
  authLoginMaxFailures: number;
  authLoginWindowMinutes: number;
  authLoginLockoutMinutes: number;
  authLoginRateLimitMax: number;
  authRegisterMaxFailures: number;
  authRegisterWindowMinutes: number;
  authRegisterLockoutMinutes: number;
  authRegisterRateLimitMax: number;
  apiAuthMaxFailures: number;
  apiAuthWindowMinutes: number;
  apiAuthLockoutMinutes: number;
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
    throw new Error('Only Australia/Sydney timezone is supported');
  }

  const nodeEnv = env.NODE_ENV ?? 'development';
  const embeddedPg = parseBoolEnv(env, 'EMBEDDED_PG', false);
  const embeddedPostgres: EmbeddedPostgresOptions = {
    dataDir: env.EMBEDDED_PG_DATA_DIR ?? '/var/lib/seqta-calendar/pg',
    port: parseIntEnv(env, 'EMBEDDED_PG_PORT', 54329),
    user: env.EMBEDDED_PG_USER ?? 'seqta',
    password: env.EMBEDDED_PG_PASSWORD ?? 'seqta',
    database: env.EMBEDDED_PG_DATABASE ?? 'seqta_calendar',
    createPostgresUser: parseBoolEnv(env, 'EMBEDDED_PG_CREATE_USER', false),
  };

  const databaseUrl =
    env.DATABASE_URL ??
    (embeddedPg
      ? `postgresql://${encodeURIComponent(embeddedPostgres.user)}:${encodeURIComponent(embeddedPostgres.password)}@127.0.0.1:${embeddedPostgres.port}/${encodeURIComponent(embeddedPostgres.database)}`
      : 'postgresql://seqta:seqta@127.0.0.1:5432/seqta_calendar');

  const sessionSecretRaw = env.SESSION_SECRET;
  if (!sessionSecretRaw) {
    if (nodeEnv === 'production') {
      throw new Error('SESSION_SECRET is required in production');
    }
  }
  const sessionSecret = Buffer.from(sessionSecretRaw ?? env.TOKEN_PEPPER!, 'base64');
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must decode to at least 32 bytes');
  }

  const ownerBootstrapEmail = env.OWNER_BOOTSTRAP_EMAIL?.trim().toLowerCase() || undefined;
  const ownerBootstrapPassword = env.OWNER_BOOTSTRAP_PASSWORD || undefined;
  if (ownerBootstrapPassword && !ownerBootstrapEmail) {
    throw new Error('OWNER_BOOTSTRAP_EMAIL is required when OWNER_BOOTSTRAP_PASSWORD is set');
  }

  return {
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port: parseIntEnv(env, 'PORT', 3210),
    databaseUrl,
    embeddedPg,
    embeddedPostgres,
    defaultTimezone,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? 'https://timetable.leoze.top',
    tokenPepper,
    uidSecret,
    allowedOrigins,
    maxBodyBytes: parseIntEnv(env, 'MAX_BODY_BYTES', 2 * 1024 * 1024),
    maxLessonsPerSync: parseIntEnv(env, 'MAX_LESSONS_PER_SYNC', 2000),
    maxSyncRangeDays: parseIntEnv(env, 'MAX_SYNC_RANGE_DAYS', 120),
    cancelledFeedRetentionDays: parseIntEnv(env, 'CANCELLED_FEED_RETENTION_DAYS', 14),
    logLevel: env.LOG_LEVEL ?? 'info',
    trustProxy: parseBoolEnv(env, 'TRUST_PROXY', true),
    sessionSecret,
    sessionTtlHours: parseIntEnv(env, 'SESSION_TTL_HOURS', 168),
    cookieSecure: parseBoolEnv(env, 'COOKIE_SECURE', nodeEnv === 'production'),
    authDevLoginEnabled: parseBoolEnv(env, 'AUTH_DEV_LOGIN', nodeEnv !== 'production'),
    ownerBootstrapEmail,
    ownerBootstrapPassword,
    authLoginMaxFailures: parseIntEnv(env, 'AUTH_LOGIN_MAX_FAILURES', 5),
    authLoginWindowMinutes: parseIntEnv(env, 'AUTH_LOGIN_WINDOW_MINUTES', 15),
    authLoginLockoutMinutes: parseIntEnv(env, 'AUTH_LOGIN_LOCKOUT_MINUTES', 15),
    authLoginRateLimitMax: parseIntEnv(env, 'AUTH_LOGIN_RATE_LIMIT_MAX', 20),
    authRegisterMaxFailures: parseIntEnv(env, 'AUTH_REGISTER_MAX_FAILURES', 10),
    authRegisterWindowMinutes: parseIntEnv(env, 'AUTH_REGISTER_WINDOW_MINUTES', 60),
    authRegisterLockoutMinutes: parseIntEnv(env, 'AUTH_REGISTER_LOCKOUT_MINUTES', 30),
    authRegisterRateLimitMax: parseIntEnv(env, 'AUTH_REGISTER_RATE_LIMIT_MAX', 15),
    apiAuthMaxFailures: parseIntEnv(env, 'API_AUTH_MAX_FAILURES', 40),
    apiAuthWindowMinutes: parseIntEnv(env, 'API_AUTH_WINDOW_MINUTES', 15),
    apiAuthLockoutMinutes: parseIntEnv(env, 'API_AUTH_LOCKOUT_MINUTES', 15),
  };
}
