import fp from 'fastify-plugin';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { applyMigrations } from '../db/migrate.js';

const databasePlugin: FastifyPluginAsync = async (app) => {
  const { databasePath } = app.config;
  mkdirSync(dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');

  const applied = applyMigrations(db);
  if (applied.length > 0) {
    app.log.info({ event: 'migration_completed', applied });
  }

  app.decorate('db', db);

  app.addHook('onClose', async () => {
    db.close();
  });
};

export default fp(databasePlugin, { name: 'database' });
