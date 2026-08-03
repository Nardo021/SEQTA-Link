import type { FastifyPluginAsync } from 'fastify';
import { validateDataDirectoryWritable } from '../../config.js';
import { isMigrationComplete } from '../../db/migrate.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, boolean> = {
      sqlite: false,
      migrations: false,
      dataDirectoryWritable: false,
      uidSecretLoaded: false,
    };

    try {
      app.db.prepare('SELECT 1').get();
      checks.sqlite = true;
    } catch {
      checks.sqlite = false;
    }

    try {
      checks.migrations = isMigrationComplete(app.db);
    } catch {
      checks.migrations = false;
    }

    checks.dataDirectoryWritable = validateDataDirectoryWritable(app.config.databasePath);
    checks.uidSecretLoaded = app.config.uidSecret.length >= 32;

    const ready = Object.values(checks).every(Boolean);

    if (!ready) {
      reply.status(503);
    }

    return {
      status: ready ? 'ok' : 'degraded',
      checks,
    };
  });
};
