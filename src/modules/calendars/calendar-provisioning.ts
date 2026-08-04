import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { generateRawToken } from '../../shared/crypto.js';
import { nowIso } from '../../shared/dates.js';
import type { CalendarRecord, UserRecord } from '../../shared/types.js';
import type { TokenService } from '../feeds/token.service.js';
import { CalendarRepository } from './calendar.repository.js';

export async function provisionUserCalendar(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
  user: UserRecord,
): Promise<CalendarRecord> {
  const calendarRepo = new CalendarRepository(db);
  const existing = await calendarRepo.findByOwnerUserId(user.id);
  if (existing) {
    return existing;
  }

  const calendarToken = generateRawToken('calendar');
  const now = nowIso();
  return calendarRepo.createCalendar({
    id: randomUUID(),
    ownerUserId: user.id,
    name: `${user.displayName} Timetable`,
    timezone: config.defaultTimezone,
    calendarTokenHash: tokenService.hash('calendar', calendarToken),
    calendarTokenPrefix: calendarToken.slice(0, 12),
    now,
  });
}
