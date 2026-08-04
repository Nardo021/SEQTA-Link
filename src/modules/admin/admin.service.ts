import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import { AuditRepository } from '../audit/audit.repository.js';
import { CalendarReadService } from '../calendars/calendar-read.service.js';
import { CalendarRepository } from '../calendars/calendar.repository.js';
import { CalendarService } from '../calendars/calendar.service.js';
import { DeviceRepository } from '../calendars/device.repository.js';
import type { TokenService } from '../feeds/token.service.js';
import { InvitationRepository } from '../invitations/invitation.repository.js';
import { InvitationService } from '../invitations/invitation.service.js';
import { SourceIdentityRepository } from '../source-identities/source-identity.repository.js';
import { UserRepository } from '../users/user.repository.js';

export class AdminService {
  private readonly userRepo: UserRepository;
  private readonly calendarRepo: CalendarRepository;
  private readonly deviceRepo: DeviceRepository;
  private readonly calendarRead: CalendarReadService;
  private readonly calendarService: CalendarService;
  private readonly auditRepo: AuditRepository;
  private readonly sourceIdentityRepo: SourceIdentityRepository;
  private readonly invitationRepo: InvitationRepository;
  private readonly invitationService: InvitationService;

  constructor(
    private readonly db: DbClient,
    private readonly config: AppConfig,
    tokenService: TokenService,
  ) {
    this.userRepo = new UserRepository(db);
    this.calendarRepo = new CalendarRepository(db);
    this.deviceRepo = new DeviceRepository(db);
    this.calendarRead = new CalendarReadService(db);
    this.calendarService = new CalendarService(db, config, tokenService, this.calendarRepo, this.deviceRepo);
    this.auditRepo = new AuditRepository(db);
    this.sourceIdentityRepo = new SourceIdentityRepository(db);
    this.invitationRepo = new InvitationRepository(db);
    this.invitationService = new InvitationService(db, config, tokenService);
  }

  async getDashboard() {
    const users = await this.userRepo.listUsers();
    const active = users.filter((u) => u.accountStatus === 'active').length;
    const suspended = users.filter((u) => u.accountStatus === 'suspended').length;
    return {
      users: { total: users.length, active, suspended },
      invitations: {
        pending: (await this.invitationRepo.listActive()).filter((i) => !i.usedAt).length,
      },
    };
  }

  async listUsers() {
    const users = await this.userRepo.listUsers();
    return {
      users: users.map((user) => this.publicUser(user)),
    };
  }

  async getUser(userId: string) {
    const user = await this.requireUser(userId);
    const calendar = await this.calendarRepo.findByOwnerUserId(userId);
    const sourceIdentity = calendar
      ? await this.sourceIdentityRepo.findByCalendarId(calendar.id)
      : null;
    return {
      user: this.publicUser(user),
      calendar: calendar
        ? {
            id: calendar.id,
            name: calendar.name,
            revision: calendar.revision,
            lastSyncedAt: calendar.lastSyncedAt,
          }
        : null,
      sourceIdentity,
    };
  }

  async updateUser(actor: UserRecord, userId: string, input: { displayName?: string; maxDevices?: number }) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const updated = await this.userRepo.updateUser(userId, input, nowIso());
    await this.audit(actor, userId, 'user.update', input);
    return { user: this.publicUser(updated!) };
  }

  async suspendUser(actor: UserRecord, userId: string) {
    return this.setAccountStatus(actor, userId, 'suspended', 'user.suspend');
  }

  async activateUser(actor: UserRecord, userId: string) {
    return this.setAccountStatus(actor, userId, 'active', 'user.activate');
  }

  async setSyncEnabled(actor: UserRecord, userId: string, enabled: boolean) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const updated = await this.userRepo.updateUser(userId, { syncEnabled: enabled }, nowIso());
    await this.audit(actor, userId, enabled ? 'user.enable_sync' : 'user.disable_sync');
    return { user: this.publicUser(updated!) };
  }

  async setFeedEnabled(actor: UserRecord, userId: string, enabled: boolean) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const updated = await this.userRepo.updateUser(userId, { feedEnabled: enabled }, nowIso());
    await this.audit(actor, userId, enabled ? 'user.enable_feed' : 'user.disable_feed');
    return { user: this.publicUser(updated!) };
  }

  async getUserTimetable(userId: string, from?: string, until?: string) {
    const calendar = await this.requireCalendar(userId);
    return this.calendarRead.listTimetable(calendar.id, from, until);
  }

  async getUserSyncRuns(userId: string, limit = 20) {
    const calendar = await this.requireCalendar(userId);
    return this.calendarRead.listSyncRuns(calendar.id, limit);
  }

  async getUserDevices(userId: string) {
    await this.requireUser(userId);
    return this.calendarRead.listDevices(userId);
  }

  async revokeDevice(actor: UserRecord, deviceId: string) {
    const revoked = await this.deviceRepo.revokeDeviceById(deviceId, nowIso());
    if (!revoked) {
      throw new AppError('INVALID_REQUEST', 'Device not found.', 404);
    }
    await this.audit(actor, null, 'device.revoke', { deviceId });
    return { ok: true };
  }

  async resetSourceIdentity(actor: UserRecord, userId: string, confirmName: string) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    if (confirmName !== user.displayName) {
      throw new AppError('INVALID_REQUEST', 'Confirmation name does not match.', 400);
    }
    const calendar = await this.requireCalendar(userId);
    const now = nowIso();
    await this.sourceIdentityRepo.resetIdentity(calendar.id, actor.id, now);
    const revokedCount = await this.deviceRepo.revokeAllForOwner(userId, now);
    await this.audit(actor, userId, 'source_identity.reset', { revokedDevices: revokedCount });
    return { ok: true, revokedDevices: revokedCount };
  }

  async rotateCalendarToken(actor: UserRecord, userId: string) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const calendar = await this.requireCalendar(userId);
    const newToken = await this.calendarService.rotateCalendarToken(calendar.id);
    await this.audit(actor, userId, 'calendar.rotate_token');
    return {
      calendarUrl: `${this.config.publicBaseUrl}/calendar/${newToken}.ics`,
    };
  }

  async createInvitation(actor: UserRecord, input: Parameters<InvitationService['createInvitation']>[1]) {
    const result = await this.invitationService.createInvitation(actor, input);
    await this.audit(actor, null, 'invitation.create', { invitationId: result.invitationId });
    return result;
  }

  async listInvitations() {
    const invitations = await this.invitationRepo.listActive();
    return {
      invitations: invitations.map((inv) => ({
        id: inv.id,
        expectedName: inv.expectedName,
        note: inv.note,
        syncEnabled: inv.syncEnabled,
        feedEnabled: inv.feedEnabled,
        maxDevices: inv.maxDevices,
        expiresAt: inv.expiresAt,
        usedAt: inv.usedAt,
        createdAt: inv.createdAt,
      })),
    };
  }

  async deleteInvitation(actor: UserRecord, invitationId: string) {
    const deleted = await this.invitationRepo.deleteUnused(invitationId);
    if (!deleted) {
      throw new AppError('INVALID_REQUEST', 'Invitation not found or already used.', 404);
    }
    await this.audit(actor, null, 'invitation.delete', { invitationId });
    return { ok: true };
  }

  async listAuditLogs(limit = 50) {
    const logs = await this.auditRepo.listRecent(limit);
    return { logs };
  }

  private async setAccountStatus(
    actor: UserRecord,
    userId: string,
    status: UserRecord['accountStatus'],
    action: string,
  ) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const updated = await this.userRepo.updateUser(userId, { accountStatus: status }, nowIso());
    if (status !== 'active') {
      await this.deviceRepo.revokeAllForOwner(userId, nowIso());
    }
    await this.audit(actor, userId, action);
    return { user: this.publicUser(updated!) };
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('FORBIDDEN', 'Forbidden.', 403);
    }
    return user;
  }

  private async requireCalendar(userId: string) {
    const calendar = await this.calendarRepo.findByOwnerUserId(userId);
    if (!calendar) {
      throw new AppError('INVALID_REQUEST', 'Calendar not found.', 404);
    }
    return calendar;
  }

  private assertCanManage(actor: UserRecord, target: UserRecord) {
    if (target.role === 'owner' && actor.role !== 'owner') {
      throw new AppError('FORBIDDEN', 'Forbidden.', 403);
    }
  }

  private publicUser(user: UserRecord) {
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      role: user.role,
      accountStatus: user.accountStatus,
      syncEnabled: user.syncEnabled,
      feedEnabled: user.feedEnabled,
      maxDevices: user.maxDevices,
      createdAt: user.createdAt,
    };
  }

  private async audit(
    actor: UserRecord,
    targetUserId: string | null,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.auditRepo.write({
      actorUserId: actor.id,
      actorType: actor.role,
      targetUserId,
      action,
      metadata,
    });
  }
}
