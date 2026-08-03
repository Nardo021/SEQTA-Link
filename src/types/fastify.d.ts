import type { FastifyRequest } from 'fastify';
import type { FeedRecord } from '../shared/types.js';
import type Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    db: Database.Database;
  }

  interface FastifyRequest {
    requestId: string;
    feed?: FeedRecord;
    rawToken?: string;
    tokenType?: 'upload' | 'calendar';
  }
}

export type { FastifyRequest };
