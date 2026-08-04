import type { Pool, PoolClient, QueryResultRow } from 'pg';

export type DbApiRole =
  | 'seqta_migrator'
  | 'seqta_device_api'
  | 'seqta_feed_api'
  | 'seqta_cli'
  | 'seqta_backup'
  | 'seqta_user_api'
  | 'seqta_admin_api';

export interface DbClient {
  readonly apiRole?: DbApiRole;
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  withUserContext<T>(userId: string, fn: (client: DbClient) => Promise<T>): Promise<T>;
  withRole<T>(role: DbApiRole, fn: (client: DbClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface AppDatabase {
  migrator: DbClient;
  device: DbClient;
  feed: DbClient;
  cli: DbClient;
  user: DbClient;
  admin: DbClient;
  backup: DbClient;
  close(): Promise<void>;
}

class PgDbClient implements DbClient {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly releaseOnClose = false,
    readonly apiRole?: DbApiRole,
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.withScopedClient((client) => client.query<T>(sql, params));
    return result.rows;
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async exec(sql: string, params: unknown[] = []): Promise<void> {
    await this.query(sql, params);
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const poolClient = await this.acquireDedicatedClient();
    const shouldRelease = this.isPool();
    try {
      await this.applyRole(poolClient);
      await poolClient.query('BEGIN');
      const txClient = new PgDbClient(poolClient, false, this.apiRole);
      const result = await fn(txClient);
      await poolClient.query('COMMIT');
      return result;
    } catch (error) {
      await poolClient.query('ROLLBACK');
      throw error;
    } finally {
      if (shouldRelease) {
        await this.resetSessionState(poolClient);
        poolClient.release();
      }
    }
  }

  async withUserContext<T>(
    userId: string,
    fn: (client: DbClient) => Promise<T>,
  ): Promise<T> {
    const poolClient = await this.acquireDedicatedClient();
    const shouldRelease = this.isPool();
    try {
      await this.applyRole(poolClient);
      await poolClient.query(`SELECT set_config('app.current_user_id', $1, false)`, [userId]);
      const scoped = new PgDbClient(poolClient, false, this.apiRole);
      return await fn(scoped);
    } finally {
      if (shouldRelease) {
        await this.resetSessionState(poolClient);
        poolClient.release();
      }
    }
  }

  async withRole<T>(role: DbApiRole, fn: (client: DbClient) => Promise<T>): Promise<T> {
    const poolClient = await this.acquireDedicatedClient();
    const shouldRelease = this.isPool();
    try {
      await poolClient.query(`SET ROLE ${quoteIdent(role)}`);
      const scoped = new PgDbClient(poolClient, false, role);
      return await fn(scoped);
    } finally {
      if (shouldRelease) {
        await this.resetSessionState(poolClient);
        poolClient.release();
      }
    }
  }

  async close(): Promise<void> {
    if (this.releaseOnClose && 'release' in this.client) {
      this.client.release();
    }
    if (this.isPool()) {
      await (this.client as Pool).end();
    }
  }

  private async withScopedClient<T>(
    fn: (client: Pool | PoolClient) => Promise<T>,
  ): Promise<T> {
    if (!this.apiRole || !this.isPool()) {
      return fn(this.client);
    }
    const poolClient = await this.acquireDedicatedClient();
    try {
      await this.applyRole(poolClient);
      return await fn(poolClient);
    } finally {
      await this.resetSessionState(poolClient);
      poolClient.release();
    }
  }

  private async applyRole(client: PoolClient): Promise<void> {
    if (this.apiRole) {
      await client.query(`SET ROLE ${quoteIdent(this.apiRole)}`);
    }
  }

  private async resetSessionState(client: PoolClient): Promise<void> {
    try {
      await client.query(`SELECT set_config('app.current_user_id', '', false)`);
      await client.query('RESET ROLE');
    } catch {
      // Connection may already be broken; pool will discard on release errors.
    }
  }

  private isPool(): boolean {
    return 'totalCount' in this.client;
  }

  private async acquireDedicatedClient(): Promise<PoolClient> {
    if (this.isPool()) {
      return (this.client as Pool).connect();
    }
    return this.client as PoolClient;
  }
}

function quoteIdent(ident: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(ident)) {
    throw new Error(`Invalid PostgreSQL identifier: ${ident}`);
  }
  return `"${ident.replace(/"/g, '""')}"`;
}

export function createDbClient(pool: Pool, apiRole?: DbApiRole): DbClient {
  return new PgDbClient(pool, false, apiRole);
}

export async function createPool(databaseUrl: string): Promise<Pool> {
  const { default: pg } = await import('pg');
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
  });
}

export async function ensureRoleGrants(db: DbClient): Promise<void> {
  await db.exec(`
    DO $$
    BEGIN
      EXECUTE format(
        'GRANT seqta_migrator, seqta_device_api, seqta_feed_api, seqta_cli, seqta_user_api, seqta_admin_api, seqta_backup, seqta_owner TO %I',
        current_user
      );
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END $$;
  `);
}

export async function pingDatabase(db: DbClient): Promise<boolean> {
  try {
    await db.queryOne('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}
