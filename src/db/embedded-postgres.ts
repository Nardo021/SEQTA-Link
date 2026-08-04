import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

export interface EmbeddedPostgresOptions {
  dataDir: string;
  port: number;
  user: string;
  password: string;
  database: string;
  createPostgresUser: boolean;
}

export interface EmbeddedPostgresHandle {
  databaseUrl: string;
  startedByUs: boolean;
  stop: () => Promise<void>;
}

export interface EmbeddedPostgresLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn?: (obj: Record<string, unknown>, msg?: string) => void;
  debug?: (obj: Record<string, unknown>, msg?: string) => void;
}

export function buildEmbeddedDatabaseUrl(options: EmbeddedPostgresOptions, database = options.database): string {
  const user = encodeURIComponent(options.user);
  const password = encodeURIComponent(options.password);
  const db = encodeURIComponent(database);
  return `postgresql://${user}:${password}@127.0.0.1:${options.port}/${db}`;
}

async function clusterInitialized(dataDir: string): Promise<boolean> {
  try {
    await access(join(dataDir, 'PG_VERSION'), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function canConnect(databaseUrl: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 1_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureDatabaseExists(options: EmbeddedPostgresOptions): Promise<void> {
  const adminUrl = buildEmbeddedDatabaseUrl(options, 'postgres');
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existing = await client.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      [options.database],
    );
    if (!existing.rows[0]?.exists) {
      await client.query(`CREATE DATABASE ${client.escapeIdentifier(options.database)}`);
    }
  } finally {
    await client.end();
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

/**
 * Start (or attach to) an embedded PostgreSQL cluster and ensure the app database exists.
 * When another process already owns the cluster, returns a no-op stop.
 */
export async function ensureEmbeddedPostgres(
  options: EmbeddedPostgresOptions,
  logger?: EmbeddedPostgresLogger,
): Promise<EmbeddedPostgresHandle> {
  const databaseUrl = buildEmbeddedDatabaseUrl(options);
  const adminUrl = buildEmbeddedDatabaseUrl(options, 'postgres');

  if (await canConnect(databaseUrl) || await canConnect(adminUrl)) {
    await ensureDatabaseExists(options);
    logger?.info(
      { event: 'embedded_postgres_attached', port: options.port, dataDir: options.dataDir },
      'Attached to running embedded PostgreSQL',
    );
    return {
      databaseUrl,
      startedByUs: false,
      stop: async () => undefined,
    };
  }

  await mkdir(options.dataDir, { recursive: true });

  const instance = new EmbeddedPostgres({
    databaseDir: options.dataDir,
    user: options.user,
    password: options.password,
    port: options.port,
    persistent: true,
    authMethod: 'password',
    initdbFlags: ['--encoding=UTF8'],
    createPostgresUser: options.createPostgresUser,
    onLog: (message) => {
      logger?.debug?.({ event: 'embedded_postgres_log', message: String(message).trim() });
    },
    onError: (messageOrError) => {
      const message =
        messageOrError instanceof Error ? messageOrError.message : String(messageOrError);
      logger?.warn?.({ event: 'embedded_postgres_stderr', message: message.trim() });
    },
  });

  if (!(await clusterInitialized(options.dataDir))) {
    logger?.info(
      { event: 'embedded_postgres_init', dataDir: options.dataDir },
      'Initialising embedded PostgreSQL cluster',
    );
    await instance.initialise();
  }

  logger?.info(
    { event: 'embedded_postgres_start', port: options.port, dataDir: options.dataDir },
    'Starting embedded PostgreSQL',
  );
  await instance.start();

  try {
    await instance.createDatabase(options.database);
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      // Race: DB may already exist; verify via SQL before failing.
      try {
        await ensureDatabaseExists(options);
      } catch {
        await instance.stop().catch(() => undefined);
        throw error;
      }
    }
  }

  return {
    databaseUrl,
    startedByUs: true,
    stop: async () => {
      logger?.info({ event: 'embedded_postgres_stop', port: options.port }, 'Stopping embedded PostgreSQL');
      await instance.stop();
    },
  };
}
