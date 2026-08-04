import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import {
  resolveCalendarTokenRecord,
  resolveUploadTokenContext,
} from '../../db/token-resolve.js';
import { nowIso } from '../../shared/dates.js';
import { generateRawToken } from '../../shared/crypto.js';
import type { CalendarRecord, SyncContext } from '../../shared/types.js';
import { AppError } from '../../shared/errors.js';
import { CalendarRepository } from '../calendars/calendar.repository.js';
import { DeviceRepository } from '../calendars/device.repository.js';
import { UserRepository } from '../users/user.repository.js';
import { TokenService } from '../feeds/token.service.js';

export interface CreateCalendarInput {
  name: string;
  schoolHost: string;
  studentRef: string;
  timezone: string;
  ownerDisplayName?: string;
}

export interface CreateCalendarResult {
  calendar: CalendarRecord;
  uploadToken: string;
  calendarToken: string;
  calendarUrl: string;
  deviceId: string;
}

export class CalendarService {
  private readonly calendarRepo: CalendarRepository;
  private readonly deviceRepo: DeviceRepository;
  private readonly userRepo: UserRepository;

  constructor(
    private readonly db: DbClient,
    private readonly config: AppConfig,
    private readonly tokenService: TokenService,
    calendarRepo?: CalendarRepository,
    deviceRepo?: DeviceRepository,
    userRepo?: UserRepository,
  ) {
    this.calendarRepo = calendarRepo ?? new CalendarRepository(db);
    this.deviceRepo = deviceRepo ?? new DeviceRepository(db);
    this.userRepo = userRepo ?? new UserRepository(db);
  }

  async createCalendar(input: CreateCalendarInput): Promise<CreateCalendarResult> {
    if (input.timezone !== this.config.defaultTimezone) {
      throw new AppError('INVALID_TIMEZONE', 'Only Australia/Sydney is supported.', 400);
    }

    const uploadToken = generateRawToken('upload');
    const calendarToken = generateRawToken('calendar');
    const now = nowIso();
    const ownerId = randomUUID();
    const calendarId = randomUUID();
    const deviceId = randomUUID();

    const owner = await this.userRepo.createUser({
      id: ownerId,
      oidcIssuer: 'bootstrap:',
      oidcSubject: `calendar:${calendarId}`,
      displayName: input.ownerDisplayName ?? input.name,
      role: 'owner',
      now,
    });

    const calendar = await this.db.withUserContext(owner.id, async (client) => {
      const calendarRepo = new CalendarRepository(client);
      const deviceRepo = new DeviceRepository(client);
      const created = await calendarRepo.createCalendar({
        id: calendarId,
        ownerUserId: owner.id,
        name: input.name,
        timezone: input.timezone,
        schoolHost: input.schoolHost,
        studentRef: input.studentRef,
        calendarTokenHash: this.tokenService.hash('calendar', calendarToken),
        calendarTokenPrefix: calendarToken.slice(0, 12),
        now,
      });
      await deviceRepo.createDevice({
        id: deviceId,
        ownerUserId: owner.id,
        calendarId: created.id,
        name: 'Bootstrap Upload',
        tokenHash: this.tokenService.hash('upload', uploadToken),
        tokenPrefix: uploadToken.slice(0, 12),
        now,
      });
      return created;
    });

    return {
      calendar,
      uploadToken,
      calendarToken,
      calendarUrl: `${this.config.publicBaseUrl}/calendar/${calendarToken}.ics`,
      deviceId,
    };
  }

  async authenticateDeviceToken(rawToken: string): Promise<SyncContext> {
    const hash = this.tokenService.hash('device', rawToken);
    return resolveUploadTokenContext(this.db, hash, { requireSyncEnabled: true });
  }

  async authenticateUploadToken(rawToken: string): Promise<SyncContext> {
    const hash = this.tokenService.hash('upload', rawToken);
    return resolveUploadTokenContext(this.db, hash, { requireSyncEnabled: true });
  }

  async authenticateCalendarToken(rawToken: string): Promise<CalendarRecord> {
    const hash = this.tokenService.hash('calendar', rawToken);
    return resolveCalendarTokenRecord(this.db, hash);
  }

  async findById(calendarId: string): Promise<CalendarRecord> {
    const calendar = await this.calendarRepo.findById(calendarId);
    if (!calendar) {
      throw new AppError('INVALID_REQUEST', 'Calendar not found.', 404);
    }
    return calendar;
  }

  async rotateCalendarToken(calendarId: string): Promise<string> {
    await this.findById(calendarId);
    const newToken = generateRawToken('calendar');
    await this.calendarRepo.updateCalendarToken(
      calendarId,
      this.tokenService.hash('calendar', newToken),
      newToken.slice(0, 12),
      nowIso(),
    );
    return newToken;
  }

  async getStatus(context: SyncContext) {
    const { calendar, device } = context;
    const stats = await this.calendarRepo.getEventStats(calendar.id);
    const lastStatus = (await this.calendarRepo.getLastSyncStatus(calendar.id)) ?? 'unknown';
    return {
      feed: {
        name: calendar.name,
        timezone: calendar.timezone,
        revision: calendar.revision,
      },
      sync: {
        lastSyncedAt: calendar.lastSyncedAt,
        lastChangedAt: calendar.lastChangedAt,
        lastStatus,
      },
      events: stats,
      device: {
        id: device.id,
        name: device.name,
        lastSyncedAt: device.lastSyncedAt,
      },
    };
  }
}
