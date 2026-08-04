import { openDatabase, createCalendarService } from './db.js';
import { parseArgs } from './parse-args.js';
import { generateRawToken } from '../shared/crypto.js';
import { createTokenService } from '../modules/feeds/token.service.js';
import { DeviceRepository } from '../modules/calendars/device.repository.js';
import { nowIso } from '../shared/dates.js';
import { randomUUID } from 'node:crypto';

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

  const { db, config } = await openDatabase();
  try {
    const client = db.admin;
    const calendarService = createCalendarService(client, config);
    const calendar = await calendarService.findById(calendarId);

    let newToken: string;
    if (type === 'calendar') {
      newToken = await calendarService.rotateCalendarToken(calendarId);
    } else {
      const tokenService = createTokenService(config);
      newToken = generateRawToken('upload');
      const deviceRepo = new DeviceRepository(client);
      await client.exec(
        `UPDATE devices SET status = 'revoked', revoked_at = $2
         WHERE calendar_id = $1 AND status = 'active'`,
        [calendarId, nowIso()],
      );
      await deviceRepo.createDevice({
        id: randomUUID(),
        ownerUserId: calendar.ownerUserId,
        calendarId,
        name: 'Rotated Upload Device',
        tokenHash: tokenService.hash('upload', newToken),
        tokenPrefix: newToken.slice(0, 12),
        now: nowIso(),
      });
    }

    console.log(`${type === 'upload' ? 'Upload' : 'Calendar'} Token:`);
    console.log(newToken);
    if (type === 'calendar') {
      console.log('');
      console.log('Calendar URL:');
      console.log(`${config.publicBaseUrl}/calendar/${newToken}.ics`);
    }
    console.log('');
    console.log('Store this token securely. It cannot be recovered later.');
  } finally {
    await db.close();
  }
}
