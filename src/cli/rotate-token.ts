import { randomUUID } from 'node:crypto';
import { CalendarService } from '../modules/calendars/calendar.service.js';
import { DeviceRepository } from '../modules/devices/device.repository.js';
import { generateRawToken } from '../shared/crypto.js';
import { nowIso } from '../shared/dates.js';
import { withCalendarOwnerContext } from './calendar-owner.js';
import { closeDatabase, openDatabase } from './db.js';
import { parseArgs } from './parse-args.js';

export async function rotateTokenCommand(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const calendarId = (options.feed ?? options.calendar) as string | undefined;
  const type = options.type as 'upload' | 'calendar' | undefined;

  if (!calendarId || (type !== 'upload' && type !== 'calendar')) {
    console.error(
      'Usage: npm run cli -- rotate-token --feed <calendar-id> --type upload|calendar',
    );
    process.exit(1);
  }

  const handle = await openDatabase();
  try {
    const newToken = await withCalendarOwnerContext(handle.db.cli, calendarId, async (client, ownerUserId) => {
      const calendarService = CalendarService.fromDb(client, handle.tokenService);
      await calendarService.findById(calendarId);

      if (type === 'calendar') {
        return calendarService.rotateCalendarToken(calendarId);
      }

      const token = generateRawToken('upload');
      const deviceRepo = new DeviceRepository(client);
      await client.exec(
        `UPDATE devices SET status = 'revoked', revoked_at = $2
         WHERE calendar_id = $1 AND status = 'active'`,
        [calendarId, nowIso()],
      );
      await deviceRepo.createDevice({
        id: randomUUID(),
        ownerUserId,
        calendarId,
        name: 'Rotated Upload Device',
        tokenHash: handle.tokenService.hash('upload', token),
        tokenPrefix: token.slice(0, 12),
        now: nowIso(),
      });
      return token;
    });

    console.log(`${type === 'upload' ? 'Upload' : 'Calendar'} Token:`);
    console.log(newToken);
    if (type === 'calendar') {
      console.log('');
      console.log('Calendar URL:');
      console.log(`${handle.config.publicBaseUrl}/calendar/${newToken}.ics`);
    }
    console.log('');
    console.log('Store this token securely. It cannot be recovered later.');
  } finally {
    await closeDatabase(handle);
  }
}
