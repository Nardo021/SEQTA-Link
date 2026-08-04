import { openDatabase, createCalendarService } from './db.js';
import { parseArgs } from './parse-args.js';

export async function inspectFeedCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const calendarId = (options.feed ?? options.calendar) as string | undefined;

  if (!calendarId) {
    console.error('Usage: npm run cli -- inspect-feed --feed <calendar-id>');
    process.exit(1);
  }

  const { db, config } = await openDatabase();
  try {
    const client = db.admin;
    const calendarService = createCalendarService(client, config);
    const calendar = await calendarService.findById(calendarId);
    const deviceRow = await client.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM devices WHERE calendar_id = $1 AND status = 'active' LIMIT 1`,
      [calendarId],
    );
    const status = await calendarService.getStatus({
      calendar,
      device: {
        id: deviceRow?.id ?? '',
        ownerUserId: calendar.ownerUserId,
        calendarId: calendar.id,
        name: deviceRow?.name ?? 'unknown',
        tokenPrefix: '',
        status: 'active',
        createdAt: calendar.createdAt,
        lastSeenAt: null,
        lastSyncedAt: null,
      },
      ownerUserId: calendar.ownerUserId,
    });
    console.log(JSON.stringify(status, null, 2));
  } finally {
    await db.close();
  }
}
