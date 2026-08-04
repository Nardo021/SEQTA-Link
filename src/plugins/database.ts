import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createDbClient, createPool, ensureRoleGrants } from '../db/client.js';
import { createAppDatabase } from '../db/app-database.js';
import { applyMigrations } from '../db/migrate.js';
import { prepareDatabaseConnection } from '../db/prepare-database.js';

const databasePlugin: FastifyPluginAsync = async (app) => {
  const prepared = await prepareDatabaseConnection(app.config, app.log);
  const pool = await createPool(prepared.databaseUrl);
  const bootstrap = createDbClient(pool);

  const applied = await applyMigrations(bootstrap);
  if (applied.length > 0) {
    app.log.info({ event: 'migration_completed', applied });
  }
  await ensureRoleGrants(bootstrap);

  const db = createAppDatabase(pool);
  app.decorate('db', db);

  app.addHook('onClose', async () => {
    await pool.end();
    await prepared.stop();
  });
};

export default fp(databasePlugin, { name: 'database', dependencies: [] });
