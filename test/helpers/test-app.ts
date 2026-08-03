import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AppConfig } from '../../src/config.js';
import { buildApp } from '../../src/app.js';
import { testSecretsEnv } from '../../src/cli/db.js';
import type { FastifyInstance } from 'fastify';

export function createTempDbPath(prefix = 'seqta-test-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return join(dir, 'calendar.sqlite');
}

export function cleanupTempDb(path: string): void {
  rmSync(join(path, '..'), { recursive: true, force: true });
}

export async function createTestApp(dbPath?: string): Promise<{
  app: FastifyInstance;
  config: AppConfig;
  dbPath: string;
}> {
  const resolvedPath = dbPath ?? createTempDbPath();
  for (const [key, value] of Object.entries(testSecretsEnv())) {
    process.env[key] = value;
  }
  process.env.DATABASE_PATH = resolvedPath;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';

  const { loadConfig } = await import('../../src/config.js');
  const config = loadConfig();
  const app = await buildApp(config);
  await app.ready();
  return { app, config, dbPath: resolvedPath };
}

export function baseSyncPayload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    schoolHost: 'learn.example-school.edu.au',
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
