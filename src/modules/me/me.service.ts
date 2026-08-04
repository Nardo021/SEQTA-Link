import type { AppConfig } from '../../config.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import type { CalendarReadService } from '../calendars/calendar-read.service.js';
import type { CalendarRepository } from '../calendars/calendar.repository.js';
import type { CalendarService } from '../calendars/calendar.service.js';
import type { DeviceRepository } from '../devices/device.repository.js';
import type { PairingService } from '../devices/pairing.service.js';
import type { SourceIdentityRepository } from '../source-identities/source-identity.repository.js';

export interface MeServiceDeps {
  config: AppConfig;
  calendarRepo: CalendarRepository;
  deviceRepo: DeviceRepository;
  sourceIdentityRepo: SourceIdentityRepository;
  calendarRead: CalendarReadService;
  pairing: PairingService;
  calendar: CalendarService;
}

export class MeService {
  private readonly config: AppConfig;
  private readonly calendarRepo: CalendarRepository;
  private readonly deviceRepo: DeviceRepository;
  private readonly sourceIdentityRepo: SourceIdentityRepository;
  private readonly calendarRead: CalendarReadService;
  private readonly pairingService: PairingService;
  private readonly calendarService: CalendarService;

  constructor(deps: MeServiceDeps) {
    this.config = deps.config;
    this.calendarRepo = deps.calendarRepo;
    this.deviceRepo = deps.deviceRepo;
    this.sourceIdentityRepo = deps.sourceIdentityRepo;
    this.calendarRead = deps.calendarRead;
    this.pairingService = deps.pairing;
    this.calendarService = deps.calendar;
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

  async listPairingCodes(user: UserRecord) {
    const codes = await this.pairingService.listPendingCodes(user);
    return { codes };
  }

  async revokePairingCode(user: UserRecord, pairingCodeId: string): Promise<void> {
    await this.pairingService.revokePendingCode(user, pairingCodeId);
  }

  async revokeDevice(user: UserRecord, deviceId: string): Promise<void> {
    const revoked = await this.deviceRepo.revokeDevice(deviceId, user.id, nowIso());
    if (!revoked) {
      throw new AppError('INVALID_REQUEST', 'Device not found.', 404);
    }
  }

  async listSyncRuns(user: UserRecord, limit = 20) {
    const calendar = await this.requireCalendar(user);
    return this.calendarRead.listSyncRuns(calendar.id, user.id, limit);
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
