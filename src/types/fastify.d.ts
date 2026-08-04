import type { FastifyRequest } from 'fastify';
import type { CalendarRecord, SyncContext } from '../shared/types.js';
import type { AppConfig } from '../config.js';
import type { AppDatabase } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: AppDatabase;
  }

  interface FastifyRequest {
    requestId: string;
    syncContext?: SyncContext;
    feed?: CalendarRecord;
    calendar?: CalendarRecord;
    rawToken?: string;
    tokenType?: 'upload' | 'calendar' | 'device';
  }
}

export type { FastifyRequest };
