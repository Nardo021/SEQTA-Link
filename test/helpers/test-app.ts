import type { AppConfig } from '../../src/config.js';
import { buildApp } from '../../src/app.js';
import { testSecretsEnv } from '../../src/cli/db.js';
import type { FastifyInstance } from 'fastify';
import { createTestDb } from './pg-test-db.js';
import { createRealTestDatabase, hasRealPostgres } from './pg-real-db.js';
import type { AppDatabase } from '../../src/db/client.js';

let sharedMemDb: ReturnType<typeof createTestDb> | null = null;
let sharedRealDb: Awaited<ReturnType<typeof createRealTestDatabase>> | null = null;
let useRealPostgres = hasRealPostgres();

export function getSharedTestDb() {
  if (useRealPostgres) {
    throw new Error('Use createTestApp() for real Postgres shared lifecycle');
  }
  if (!sharedMemDb) {
    sharedMemDb = createTestDb();
  }
  return sharedMemDb;
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
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL_TEST ?? 'postgresql://leo@127.0.0.1:5432/seqta_calendar_test';
  }

  const { loadConfig } = await import('../../src/config.js');
  const config = loadConfig();

  let db: AppDatabase;
  if (useRealPostgres) {
    if (!sharedRealDb) {
      try {
        sharedRealDb = await createRealTestDatabase();
      } catch (error) {
        useRealPostgres = false;
        console.warn(
          '[test] Real Postgres unavailable, falling back to pg-mem:',
          error instanceof Error ? error.message : error,
        );
        db = getSharedTestDb().db;
        const app = await buildApp(config, { db });
        await app.ready();
        return { app, config, db };
      }
    } else {
      // Truncate between tests that share the pool
      await sharedRealDb.db.migrator.exec(`
        TRUNCATE TABLE
          audit_logs, sync_runs, event_aliases, events, pairing_codes,
          devices, calendar_tokens, source_identities, calendars,
          sessions, invitations, users
        RESTART IDENTITY CASCADE
      `);
    }
    db = sharedRealDb.db;
  } else {
    db = getSharedTestDb().db;
  }

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
