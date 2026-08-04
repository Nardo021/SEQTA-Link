import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
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
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcRedirectUri?: string;
  authDevLoginEnabled: boolean;
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

  const databaseUrl =
    env.DATABASE_URL ??
    'postgresql://seqta:seqta@127.0.0.1:5432/seqta_calendar';

  const sessionSecretRaw = env.SESSION_SECRET ?? env.TOKEN_PEPPER;
  const sessionSecret = Buffer.from(sessionSecretRaw!, 'base64');
  const oidcIssuer = env.OIDC_ISSUER?.replace(/\/+$/, '');
  const oidcClientId = env.OIDC_CLIENT_ID;
  const oidcClientSecret = env.OIDC_CLIENT_SECRET;
  const oidcRedirectUri = env.OIDC_REDIRECT_URI;

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '127.0.0.1',
    port: parseIntEnv(env, 'PORT', 3210),
    databaseUrl,
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
    cookieSecure: parseBoolEnv(env, 'COOKIE_SECURE', (env.NODE_ENV ?? 'development') === 'production'),
    oidcIssuer,
    oidcClientId,
    oidcClientSecret,
    oidcRedirectUri,
    authDevLoginEnabled: parseBoolEnv(env, 'AUTH_DEV_LOGIN', (env.NODE_ENV ?? 'development') !== 'production'),
  };
}

export async function validateDatabaseReady(db: { queryOne: (sql: string) => Promise<unknown> }): Promise<boolean> {
  try {
    await db.queryOne('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
