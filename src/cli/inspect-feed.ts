import { CalendarReadService } from '../modules/calendars/calendar-read.service.js';
import { CalendarService } from '../modules/calendars/calendar.service.js';
import { withCalendarOwnerContext } from './calendar-owner.js';
import { closeDatabase, openDatabase } from './db.js';
import { parseArgs } from './parse-args.js';

export async function inspectFeedCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const calendarId = (options.feed ?? options.calendar) as string | undefined;

  if (!calendarId) {
    console.error('Usage: npm run cli -- inspect-feed --feed <calendar-id>');
    process.exit(1);
  }

  const handle = await openDatabase();
  try {
    const status = await withCalendarOwnerContext(handle.db.cli, calendarId, async (client, ownerUserId) => {
      const calendar = await CalendarService.fromDb(client, handle.tokenService).findById(calendarId);
      const deviceRow = await client.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM devices WHERE calendar_id = $1 AND status = 'active' LIMIT 1`,
        [calendarId],
      );
      return new CalendarReadService(client).getStatus({
        calendar,
        device: {
          id: deviceRow?.id ?? '',
          ownerUserId,
          calendarId: calendar.id,
          name: deviceRow?.name ?? 'unknown',
          tokenPrefix: '',
          status: 'active',
          createdAt: calendar.createdAt,
          lastSeenAt: null,
          lastSyncedAt: null,
        },
        ownerUserId,
      });
    });
    console.log(JSON.stringify(status, null, 2));
  } finally {
    await closeDatabase(handle);
  }
}
