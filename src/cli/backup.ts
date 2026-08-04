import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openDatabase } from './db.js';
import { parseArgs } from './parse-args.js';

const execFileAsync = promisify(execFile);

export async function backupCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const outputDir = options.output ?? './backups';
  mkdirSync(outputDir, { recursive: true });

  const { db, config } = await openDatabase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sqlPath = join(outputDir, `seqta-calendar-${timestamp}.sql`);
  const gzipPath = `${sqlPath}.gz`;

  try {
    await execFileAsync('pg_dump', [config.databaseUrl, '--file', sqlPath, '--format=plain'], {
      env: process.env,
    });

    await execFileAsync('gzip', ['-f', sqlPath]);

    console.log(
      JSON.stringify(
        {
          event: 'backup_completed',
          source: config.databaseUrl.replace(/:[^:@/]+@/, ':***@'),
          backup: gzipPath,
          timestamp,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    writeFileSync(
      join(outputDir, `backup-failed-${timestamp}.json`),
      JSON.stringify({
        event: 'backup_failed',
        error: error instanceof Error ? error.message : String(error),
        hint: 'Ensure pg_dump is installed and DATABASE_URL is reachable.',
      }),
    );
    console.error(error);
    process.exit(1);
  } finally {
    await db.close();
  }
}
