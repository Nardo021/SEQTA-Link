import type { AppConfig } from '../config.js';
import type { DbClient } from '../db/client.js';
import { AdminService } from '../modules/admin/admin.service.js';
import { CalendarReadService } from '../modules/calendars/calendar-read.service.js';
import { CalendarRepository } from '../modules/calendars/calendar.repository.js';
import { CalendarService } from '../modules/calendars/calendar.service.js';
import { DeviceRepository } from '../modules/devices/device.repository.js';
import { PairingRepository } from '../modules/devices/pairing.repository.js';
import { PairingService } from '../modules/devices/pairing.service.js';
import { EventRepository } from '../modules/events/event.repository.js';
import { InvitationService } from '../modules/invitations/invitation.service.js';
import { MeService } from '../modules/me/me.service.js';
import { SourceIdentityRepository } from '../modules/source-identities/source-identity.repository.js';
import { SyncRepository } from '../modules/sync/sync.repository.js';
import type { SyncServiceDeps } from '../modules/sync/sync.service.js';
import type { TokenService } from '../security/token.service.js';

export function createSyncServiceDeps(db: DbClient): SyncServiceDeps {
  return {
    syncRepo: new SyncRepository(db),
    eventRepo: new EventRepository(db),
    calendarRepo: new CalendarRepository(db),
    deviceRepo: new DeviceRepository(db),
    sourceIdentityRepo: new SourceIdentityRepository(db),
  };
}

export function createPairingService(db: DbClient, tokenService: TokenService): PairingService {
  return new PairingService(
    db,
    new PairingRepository(db),
    new DeviceRepository(db),
    tokenService,
  );
}

export function createMeService(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
): MeService {
  const calendarRepo = new CalendarRepository(db);
  const deviceRepo = new DeviceRepository(db);
  return new MeService({
    config,
    calendarRepo,
    deviceRepo,
    sourceIdentityRepo: new SourceIdentityRepository(db),
    calendarRead: new CalendarReadService(db),
    pairing: createPairingService(db, tokenService),
    calendar: new CalendarService(tokenService, calendarRepo),
  });
}

export function createAdminService(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
): AdminService {
  const calendarRepo = new CalendarRepository(db);
  const deviceRepo = new DeviceRepository(db);
  return new AdminService({
    db,
    config,
    calendarRepo,
    deviceRepo,
    calendarRead: new CalendarReadService(db),
    calendar: new CalendarService(tokenService, calendarRepo),
    invitation: new InvitationService(db, config, tokenService),
  });
}
