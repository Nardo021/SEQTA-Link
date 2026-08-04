import type { FastifyPluginAsync } from 'fastify';
import { isMigrationComplete } from '../../db/migrate.js';
import { pingDatabase } from '../../db/client.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, boolean> = {
      postgres: false,
      migrations: false,
      deviceRole: false,
      feedRole: false,
      uidSecretLoaded: false,
    };

    try {
      checks.postgres = await pingDatabase(app.db.migrator);
    } catch {
      checks.postgres = false;
    }

    try {
      checks.migrations = await isMigrationComplete(app.db.migrator);
    } catch {
      checks.migrations = false;
    }

    try {
      checks.deviceRole = await pingDatabase(app.db.device);
    } catch {
      checks.deviceRole = false;
    }

    try {
      checks.feedRole = await pingDatabase(app.db.feed);
    } catch {
      checks.feedRole = false;
    }

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
