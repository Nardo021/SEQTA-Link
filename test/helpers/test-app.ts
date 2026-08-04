import type { AppConfig } from '../../src/config.js';
import { buildApp } from '../../src/app.js';
import { testSecretsEnv } from '../../src/cli/db.js';
import type { FastifyInstance } from 'fastify';
import { createTestDb } from './pg-test-db.js';
import { createRealTestDatabase, probeRealPostgres } from './pg-real-db.js';
import type { AppDatabase } from '../../src/db/client.js';

let sharedMemDb: ReturnType<typeof createTestDb> | null = null;
let sharedRealDb: Awaited<ReturnType<typeof createRealTestDatabase>> | null = null;
let usingRealPostgres: boolean | null = null;

export function getSharedTestDb() {
  if (!sharedMemDb) {
    sharedMemDb = createTestDb();
  }
  return sharedMemDb;
}

export async function isUsingRealPostgres(): Promise<boolean> {
  if (usingRealPostgres === null) {
    usingRealPostgres = await probeRealPostgres();
  }
  return usingRealPostgres;
}

async function resolveTestDatabase(): Promise<AppDatabase> {
  if (await isUsingRealPostgres()) {
    if (!sharedRealDb) {
      if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_TEST) {
        process.env.DATABASE_URL = 'postgresql://leo@127.0.0.1:5432/seqta_calendar_test';
      } else if (!process.env.DATABASE_URL && process.env.DATABASE_URL_TEST) {
        process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
      }
      sharedRealDb = await createRealTestDatabase();
    } else {
      await sharedRealDb.db.migrator.exec(`
        TRUNCATE TABLE
          audit_logs, sync_runs, event_aliases, events, pairing_codes,
          devices, calendar_tokens, source_identities, calendars,
          sessions, invitations, users
        RESTART IDENTITY CASCADE
      `);
    }
    return sharedRealDb.db;
  }

  return getSharedTestDb().db;
}

export async function createTestApp(): Promise<{
  app: FastifyInstance;
  config: AppConfig;
  db: AppDatabase;
}> {
  for (const [key, value] of Object.entries(testSecretsEnv())) {
    process.env[key] = value;
  }
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
  process.env.AUTH_DEV_LOGIN = 'true';
  process.env.EMBEDDED_PG = 'false';

  const db = await resolveTestDatabase();
  const { loadConfig } = await import('../../src/config.js');
  const config = loadConfig();
  const app = await buildApp(config, { db });
  await app.ready();
  return { app, config, db };
}

export function baseSyncPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    schoolHost: 'learn.masada.onseqtacloud.com',
    studentRef: '4284',
    timezone: 'Australia/Sydney',
    generatedAt: '2026-08-04T08:35:00+10:00',
    coverage: [{ from: '2026-08-03', until: '2026-08-09', complete: true }],
    lessons: [
      {
        sourceKey: '2026-08-05|period-2|1575659',
        date: '2026-08-05',
        periodKey: 'period-2',
        periodLabel: 'Period 2',
        courseCode: '11MUS',
        title: 'Music 1',
        teacher: 'Mr Example',
        room: 'M202',
        start: '09:35:00',
        end: '10:30:00',
        type: 'class',
      },
    ],
    ...overrides,
  };
}
