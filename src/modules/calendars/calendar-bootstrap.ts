import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { generateRawToken } from '../../shared/crypto.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { CalendarRecord } from '../../shared/types.js';
import type { TokenService } from '../../security/token.service.js';
import { DeviceRepository } from '../devices/device.repository.js';
import { UserRepository } from '../users/user.repository.js';
import { CalendarRepository } from './calendar.repository.js';

export interface BootstrapCalendarInput {
  name: string;
  schoolHost: string;
  studentRef: string;
  timezone: string;
  ownerDisplayName?: string;
}

export interface BootstrapCalendarResult {
  calendar: CalendarRecord;
  uploadToken: string;
  calendarToken: string;
  calendarUrl: string;
  deviceId: string;
}

/** CLI/test helper: creates user + calendar + upload device in one shot. */
export async function bootstrapCalendar(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
  input: BootstrapCalendarInput,
): Promise<BootstrapCalendarResult> {
  if (input.timezone !== config.defaultTimezone) {
    throw new AppError('INVALID_TIMEZONE', 'Only Australia/Sydney is supported.', 400);
  }

  const uploadToken = generateRawToken('upload');
  const calendarToken = generateRawToken('calendar');
  const now = nowIso();
  const ownerId = randomUUID();
  const calendarId = randomUUID();
  const deviceId = randomUUID();
  const userRepo = new UserRepository(db);

  const owner = await userRepo.createUser({
    id: ownerId,
    displayName: input.ownerDisplayName ?? input.name,
    role: 'user',
    now,
  });

  const calendar = await db.withUserContext(owner.id, async (client) => {
    const calendarRepo = new CalendarRepository(client);
    const deviceRepo = new DeviceRepository(client);
    const created = await calendarRepo.createCalendar({
      id: calendarId,
      ownerUserId: owner.id,
      name: input.name,
      timezone: input.timezone,
      schoolHost: input.schoolHost,
      studentRef: input.studentRef,
      calendarTokenHash: tokenService.hash('calendar', calendarToken),
      calendarTokenPrefix: calendarToken.slice(0, 12),
      now,
    });
    await deviceRepo.createDevice({
      id: deviceId,
      ownerUserId: owner.id,
      calendarId: created.id,
      name: 'Bootstrap Upload',
      tokenHash: tokenService.hash('upload', uploadToken),
      tokenPrefix: uploadToken.slice(0, 12),
      now,
    });
    return created;
  });

  return {
    calendar,
    uploadToken,
    calendarToken,
    calendarUrl: `${config.publicBaseUrl}/calendar/${calendarToken}.ics`,
    deviceId,
  };
}
