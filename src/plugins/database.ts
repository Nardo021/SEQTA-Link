import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createDbClient, createPool, ensureRoleGrants } from '../db/client.js';
import { attachRoleClients } from '../db/app-database.js';
import { applyMigrations } from '../db/migrate.js';

const databasePlugin: FastifyPluginAsync = async (app) => {
  const pool = await createPool(app.config.databaseUrl);
  const bootstrap = createDbClient(pool);

  const applied = await applyMigrations(bootstrap);
  if (applied.length > 0) {
    app.log.info({ event: 'migration_completed', applied });
  }
  await ensureRoleGrants(bootstrap);

  const device = createDbClient(pool, 'seqta_device_api');
  const db = attachRoleClients(pool, device);
  app.decorate('db', db);

  app.addHook('onClose', async () => {
    await pool.end();
  });
};

export default fp(databasePlugin, { name: 'database', dependencies: [] });
