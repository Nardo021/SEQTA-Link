import type { AppConfig } from '../config.js';
import { ensureEmbeddedPostgres, type EmbeddedPostgresLogger } from './embedded-postgres.js';

export interface PreparedDatabaseConnection {
  databaseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Resolve the runtime DATABASE_URL, starting embedded Postgres when configured.
 * Does not mutate config or process.env.
 */
export async function prepareDatabaseConnection(
  config: AppConfig,
  logger?: EmbeddedPostgresLogger,
): Promise<PreparedDatabaseConnection> {
  if (!config.embeddedPg) {
    return {
      databaseUrl: config.databaseUrl,
      stop: async () => undefined,
    };
  }

  const handle = await ensureEmbeddedPostgres(config.embeddedPostgres, logger);
  return {
    databaseUrl: handle.databaseUrl,
    stop: handle.stop,
  };
}
