import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase, createCalendarService } from './db.js';
import { parseArgs } from './parse-args.js';
import { CalendarRepository } from '../modules/calendars/calendar.repository.js';
import { DeviceRepository } from '../modules/calendars/device.repository.js';
import { UserRepository } from '../modules/users/user.repository.js';
import { IcalFeedService } from '../modules/calendar/ical-feed.service.js';
import { EventRepository } from '../modules/events/event.repository.js';
import { createTokenService } from '../modules/feeds/token.service.js';
import { nowIso } from '../shared/dates.js';

interface SqliteFeedRow {
  id: string;
  name: string;
  school_host: string;
  student_ref: string;
  timezone: string;
  upload_token_hash: string;
  calendar_token_hash: string;
  revision: number;
  last_changed_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function migrateV1SqliteCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const sqlitePath = options.db as string | undefined;
  const ownerName = (options['owner-name'] as string | undefined) ?? 'Owner';
  const outDir = (options.out as string | undefined) ?? './migration-output';

  if (!sqlitePath) {
    console.error(
      'Usage: migrate-v1-sqlite --db ./data/calendar.sqlite [--owner-name "Leo"] [--out ./migration-output]',
    );
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });

  const sqlite = new Database(sqlitePath, { readonly: true });
  const feeds = sqlite.prepare('SELECT * FROM feeds').all() as SqliteFeedRow[];

  if (feeds.length !== 1) {
    console.error(`Expected exactly 1 feed in SQLite, found ${feeds.length}`);
    process.exit(1);
  }

  const feed = feeds[0]!;
  const tokenService = createTokenService(
    (await import('../config.js')).loadConfig(process.env),
  );

  let beforeIcs = '';
  try {
    const events = sqlite
      .prepare(
        `SELECT * FROM events WHERE feed_id = ? AND active = 1 AND status = 'confirmed' ORDER BY starts_at_utc`,
      )
      .all(feed.id);
    beforeIcs = JSON.stringify({ feedId: feed.id, eventCount: events.length });
  } catch {
    beforeIcs = '';
  }

  const { db, config } = await openDatabase();
  const now = nowIso();

  try {
    await (async (client) => {
      const userRepo = new UserRepository(client);
      const calendarRepo = new CalendarRepository(client);
      const deviceRepo = new DeviceRepository(client);

      const ownerId = feed.id;
      const calendarId = feed.id;

      await userRepo.createUser({
        id: ownerId,
        oidcIssuer: 'bootstrap:',
        oidcSubject: `migrated:${calendarId}`,
        displayName: ownerName,
        role: 'owner',
        now,
      });

      await client.exec(
        `INSERT INTO calendars (
          id, owner_user_id, name, timezone, revision,
          last_synced_at, last_changed_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          calendarId,
          ownerId,
          feed.name,
          feed.timezone,
          feed.revision,
          feed.last_synced_at,
          feed.last_changed_at,
          feed.created_at,
          feed.updated_at,
        ],
      );

      await client.exec(
        `INSERT INTO source_identities (calendar_id, school_host, student_ref, locked_at)
         VALUES ($1, $2, $3, $4)`,
        [calendarId, feed.school_host, feed.student_ref, now],
      );

      await client.exec(
        `INSERT INTO calendar_tokens (calendar_id, token_hash, token_prefix, status, created_at)
         VALUES ($1, $2, $3, 'active', $4)`,
        [calendarId, feed.calendar_token_hash, 'scc_migrated', now],
      );

      await deviceRepo.createDevice({
        id: randomUUID(),
        ownerUserId: ownerId,
        calendarId,
        name: 'Migrated Upload Token',
        tokenHash: feed.upload_token_hash,
        tokenPrefix: 'scu_migrated',
        now,
      });

      const eventRows = sqlite
        .prepare('SELECT * FROM events WHERE feed_id = ?')
        .all(feed.id) as Array<Record<string, unknown>>;

      for (const row of eventRows) {
        await client.exec(
          `INSERT INTO events (
            id, owner_user_id, calendar_id, natural_key, ical_uid,
            local_date, period_key, course_code, title,
            starts_at_utc, ends_at_utc, timezone,
            teacher, room, description, event_type,
            content_hash, sequence, status, active,
            created_at, updated_at, deleted_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
          )`,
          [
            row.id,
            ownerId,
            calendarId,
            row.natural_key,
            row.ical_uid,
            row.local_date,
            row.period_key,
            row.course_code,
            row.title,
            row.starts_at_utc,
            row.ends_at_utc,
            row.timezone,
            row.teacher,
            row.room,
            row.description,
            row.event_type,
            row.content_hash,
            row.sequence,
            row.status,
            (row.active as number) === 1,
            row.created_at,
            row.updated_at,
            row.deleted_at,
          ],
        );
      }

      const aliasRows = sqlite
        .prepare('SELECT * FROM event_aliases WHERE feed_id = ?')
        .all(feed.id) as Array<Record<string, unknown>>;

      for (const row of aliasRows) {
        await client.exec(
          `INSERT INTO event_aliases (calendar_id, source_key, event_id, first_seen_at, last_seen_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [row.feed_id, row.source_key, row.event_id, row.first_seen_at, row.last_seen_at],
        );
      }

      const syncRows = sqlite
        .prepare('SELECT * FROM sync_runs WHERE feed_id = ?')
        .all(feed.id) as Array<Record<string, unknown>>;

      const deviceRow = await client.queryOne<{ id: string }>(
        `SELECT id FROM devices WHERE calendar_id = $1 LIMIT 1`,
        [calendarId],
      );

      for (const row of syncRows) {
        await client.exec(
          `INSERT INTO sync_runs (
            id, owner_user_id, calendar_id, device_id, idempotency_key,
            payload_hash, snapshot_hash, range_from, range_until,
            received_count, normalized_count, duplicate_count,
            inserted_count, updated_count, removed_count, restored_count, unchanged_count,
            status, error_code, started_at, completed_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21
          )`,
          [
            row.id,
            ownerId,
            calendarId,
            deviceRow!.id,
            row.idempotency_key,
            row.payload_hash,
            row.snapshot_hash,
            row.range_from,
            row.range_until,
            row.received_count,
            row.normalized_count,
            row.duplicate_count,
            row.inserted_count,
            row.updated_count,
            row.removed_count,
            row.restored_count,
            row.unchanged_count,
            row.status,
            row.error_code,
            row.started_at,
            row.completed_at,
          ],
        );
      }

      const calendar = await calendarRepo.findById(calendarId);
      const icalFeedService = new IcalFeedService(config, new EventRepository(client));
      const after = calendar ? await icalFeedService.getCalendar(calendar) : null;

      writeFileSync(join(outDir, 'before.snapshot.json'), beforeIcs);
      if (after) {
        writeFileSync(join(outDir, 'after.ics'), after.body);
      }

      console.log(
        JSON.stringify(
          {
            event: 'migration_completed',
            ownerId,
            calendarId,
            eventsImported: eventRows.length,
            aliasesImported: aliasRows.length,
            syncRunsImported: syncRows.length,
            outputDir: outDir,
          },
          null,
          2,
        ),
      );
    })(db.admin);
  } finally {
    sqlite.close();
    await db.close();
  }
}
