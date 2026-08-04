import type { AppConfig } from '../config.js';
import type { DbClient } from '../db/client.js';
import { CalendarRepository } from '../modules/calendars/calendar.repository.js';
import { DeviceRepository } from '../modules/calendars/device.repository.js';
import { CalendarService } from '../modules/calendars/calendar.service.js';
import { EventRepository } from '../modules/events/event.repository.js';
import type { TokenService } from '../modules/feeds/token.service.js';
import { PairingRepository, PairingService } from '../modules/devices/pairing.service.js';
import { SourceIdentityRepository } from '../modules/source-identities/source-identity.repository.js';
import { SyncRepository } from '../modules/sync/sync.repository.js';
import { SyncService, type SyncServiceDeps } from '../modules/sync/sync.service.js';
import { UserRepository } from '../modules/users/user.repository.js';
import { AdminService } from '../modules/admin/admin.service.js';
import { MeService } from '../modules/me/me.service.js';
import { InvitationService } from '../modules/invitations/invitation.service.js';

export function createSyncServiceDeps(db: DbClient): SyncServiceDeps {
  return {
    syncRepo: new SyncRepository(db),
    eventRepo: new EventRepository(db),
    calendarRepo: new CalendarRepository(db),
    deviceRepo: new DeviceRepository(db),
    sourceIdentityRepo: new SourceIdentityRepository(db),
  };
}

export interface ScopedServices {
  calendar: CalendarService;
  sync: SyncService;
  me: MeService;
  admin: AdminService;
  invitation: InvitationService;
  pairing: PairingService;
}

export function createScopedServices(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
): ScopedServices {
  return {
    calendar: new CalendarService(db, config, tokenService),
    sync: createSyncService(db, config),
    me: new MeService(db, config, tokenService),
    admin: new AdminService(db, config, tokenService),
    invitation: new InvitationService(db, config, tokenService),
    pairing: new PairingService(
      db,
      new PairingRepository(db),
      new DeviceRepository(db),
      new UserRepository(db),
      tokenService,
    ),
  };
}

export function createSyncService(
  db: DbClient,
  config: AppConfig,
  deps?: SyncServiceDeps,
): SyncService {
  return new SyncService(db, config, deps ?? createSyncServiceDeps(db));
}

export function createCalendarService(
  db: DbClient,
  config: AppConfig,
  tokenService: TokenService,
): CalendarService {
  return new CalendarService(db, config, tokenService);
}
