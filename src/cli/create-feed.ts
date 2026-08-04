import { openDatabase, createCalendarService } from './db.js';
import { parseArgs } from './parse-args.js';

export async function createFeedCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const name = options.name as string | undefined;
  const schoolHost = options['school-host'] as string | undefined;
  const studentRef = options['student-ref'] as string | undefined;
  const timezone = (options.timezone as string | undefined) ?? 'Australia/Sydney';

  if (!name || !schoolHost || !studentRef) {
    console.error(
      'Usage: create-feed --name "My Timetable" --school-host "learn.example.edu.au" --student-ref "4284" [--timezone "Australia/Sydney"]',
    );
    process.exit(1);
  }

  const { db, config } = await openDatabase();
  try {
    const result = await createCalendarService(db.cli, config).createCalendar({
      name,
      schoolHost,
      studentRef,
      timezone,
    });

    console.log(JSON.stringify({
      calendarId: result.calendar.id,
      uploadToken: result.uploadToken,
      calendarToken: result.calendarToken,
      calendarUrl: result.calendarUrl,
      deviceId: result.deviceId,
    }, null, 2));
  } finally {
    await db.close();
  }
}
