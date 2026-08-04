import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import { CalendarRepository } from '../calendars/calendar.repository.js';
import { CalendarReadService } from '../calendars/calendar-read.service.js';
import { CalendarService } from '../calendars/calendar.service.js';
import { DeviceRepository } from '../calendars/device.repository.js';
import type { TokenService } from '../feeds/token.service.js';
import { PairingRepository, PairingService } from '../devices/pairing.service.js';
import { SourceIdentityRepository } from '../source-identities/source-identity.repository.js';
import { UserRepository } from '../users/user.repository.js';

export class MeService {
  private readonly calendarRepo: CalendarRepository;
  private readonly deviceRepo: DeviceRepository;
  private readonly sourceIdentityRepo: SourceIdentityRepository;
  private readonly calendarRead: CalendarReadService;
  private readonly pairingService: PairingService;
  private readonly calendarService: CalendarService;

  constructor(
    private readonly db: DbClient,
    private readonly config: AppConfig,
    private readonly tokenService: TokenService,
  ) {
    this.calendarRepo = new CalendarRepository(db);
    this.deviceRepo = new DeviceRepository(db);
    this.sourceIdentityRepo = new SourceIdentityRepository(db);
    this.calendarRead = new CalendarReadService(db);
    this.pairingService = new PairingService(
      db,
      new PairingRepository(db),
      this.deviceRepo,
      new UserRepository(db),
      tokenService,
    );
    this.calendarService = new CalendarService(db, config, tokenService, this.calendarRepo, this.deviceRepo);
  }

  async getDashboard(user: UserRecord) {
    const calendar = await this.requireCalendar(user);
    const stats = await this.calendarRepo.getEventStats(calendar.id);
    const lastStatus = (await this.calendarRepo.getLastSyncStatus(calendar.id)) ?? 'unknown';
    const devices = await this.deviceRepo.listByOwner(user.id);
    const sourceIdentity = await this.sourceIdentityRepo.findByCalendarId(calendar.id);
    return {
      account: {
        displayName: user.displayName,
        accountStatus: user.accountStatus,
        syncEnabled: user.syncEnabled,
        feedEnabled: user.feedEnabled,
      },
      calendar: {
        name: calendar.name,
        revision: calendar.revision,
        lastSyncedAt: calendar.lastSyncedAt,
        lastChangedAt: calendar.lastChangedAt,
        lastSyncStatus: lastStatus,
      },
      events: stats,
      devices: {
        active: devices.filter((device) => device.status === 'active').length,
        max: user.maxDevices,
      },
      sourceIdentity: sourceIdentity
        ? {
            schoolHost: sourceIdentity.schoolHost,
            studentRef: sourceIdentity.studentRef,
            lockedAt: sourceIdentity.lockedAt,
          }
        : null,
    };
  }

  async getMe(user: UserRecord) {
    const calendar = await this.requireCalendar(user);
    return {
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        syncEnabled: user.syncEnabled,
        feedEnabled: user.feedEnabled,
        maxDevices: user.maxDevices,
      },
      calendar: {
        id: calendar.id,
        name: calendar.name,
        timezone: calendar.timezone,
        revision: calendar.revision,
        lastSyncedAt: calendar.lastSyncedAt,
        lastChangedAt: calendar.lastChangedAt,
      },
    };
  }

  async getTimetable(user: UserRecord, from?: string, until?: string) {
    const calendar = await this.requireCalendar(user);
    return this.calendarRead.listTimetable(calendar.id, from, until);
  }

  async getCalendar(user: UserRecord) {
    const calendar = await this.requireCalendar(user);
    const tokenPrefix = await this.calendarRepo.getActiveCalendarTokenPrefix(calendar.id);
    return {
      name: calendar.name,
      timezone: calendar.timezone,
      tokenPrefix: tokenPrefix ?? null,
      subscriptionPath: tokenPrefix ? `/calendar/${tokenPrefix}…` : null,
      revision: calendar.revision,
      lastSyncedAt: calendar.lastSyncedAt,
      feedEnabled: user.feedEnabled,
    };
  }

  async rotateCalendarToken(user: UserRecord): Promise<{ calendarToken: string; calendarUrl: string }> {
    if (!user.feedEnabled) {
      throw new AppError('FEED_DISABLED', 'Calendar feed is disabled.', 410);
    }
    const calendar = await this.requireCalendar(user);
    const newToken = await this.calendarService.rotateCalendarToken(calendar.id);
    return {
      calendarToken: newToken,
      calendarUrl: `${this.config.publicBaseUrl}/calendar/${newToken}.ics`,
    };
  }

  async listDevices(user: UserRecord) {
    return this.calendarRead.listDevices(user.id, { includeTimestamps: true });
  }

  async createPairingCode(user: UserRecord) {
    const calendar = await this.requireCalendar(user);
    return this.pairingService.createPairingCode(user, calendar.id);
  }

  async revokeDevice(user: UserRecord, deviceId: string): Promise<void> {
    const revoked = await this.deviceRepo.revokeDevice(deviceId, user.id, nowIso());
    if (!revoked) {
      throw new AppError('INVALID_REQUEST', 'Device not found.', 404);
    }
  }

  async listSyncRuns(user: UserRecord, limit = 20) {
    const calendar = await this.requireCalendar(user);
    return this.calendarRead.listSyncRuns(calendar.id, limit);
  }

  async updatePreferences(user: UserRecord, input: { calendarName?: string }) {
    const calendar = await this.requireCalendar(user);
    if (input.calendarName?.trim()) {
      await this.calendarRepo.updateCalendarName(calendar.id, input.calendarName.trim(), nowIso());
    }
    return this.getMe(user);
  }

  private async requireCalendar(user: UserRecord) {
    const calendar = await this.calendarRepo.findByOwnerUserId(user.id);
    if (!calendar) {
      throw new AppError('INVALID_REQUEST', 'Calendar not found.', 404);
    }
    return calendar;
  }
}
