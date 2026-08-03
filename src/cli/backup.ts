import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import Database from 'better-sqlite3';
import { openDatabase } from './db.js';
import { parseArgs } from './parse-args.js';

export async function backupCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const outputDir = options.output ?? './backups';
  mkdirSync(outputDir, { recursive: true });

  const { db, config } = openDatabase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(outputDir, `calendar-${timestamp}.sqlite`);
  const gzipPath = `${backupPath}.gz`;

  try {
    await db.backup(backupPath);

    const verifyDb = new Database(backupPath, { readonly: true });
    try {
      const integrityResult = verifyDb.pragma('integrity_check', { simple: true });
      const integrityStatus =
        typeof integrityResult === 'string'
          ? integrityResult
          : (integrityResult as { integrity_check: string }).integrity_check;
      if (integrityStatus !== 'ok') {
        throw new Error(`integrity_check failed: ${integrityStatus}`);
      }
    } finally {
      verifyDb.close();
    }

    await pipeline(createReadStream(backupPath), createGzip(), createWriteStream(gzipPath));

    console.log(
      JSON.stringify(
        {
          event: 'backup_completed',
          source: config.databasePath,
          backup: gzipPath,
          timestamp,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'backup_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  } finally {
    db.close();
  }
}
