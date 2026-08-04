import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import { AuditRepository } from '../audit/audit.repository.js';
import type { CalendarReadService } from '../calendars/calendar-read.service.js';
import type { CalendarRepository } from '../calendars/calendar.repository.js';
import type { CalendarService } from '../calendars/calendar.service.js';
import type { DeviceRepository } from '../devices/device.repository.js';
import { SessionRepository } from '../auth/session.repository.js';
import { InvitationRepository } from '../invitations/invitation.repository.js';
import type { InvitationService } from '../invitations/invitation.service.js';
import { SourceIdentityRepository } from '../source-identities/source-identity.repository.js';
import { UserRepository } from '../users/user.repository.js';

export interface AdminServiceDeps {
  db: DbClient;
  config: AppConfig;
  calendarRepo: CalendarRepository;
  deviceRepo: DeviceRepository;
  calendarRead: CalendarReadService;
  calendar: CalendarService;
  invitation: InvitationService;
}

export class AdminService {
  private readonly config: AppConfig;
  private readonly userRepo: UserRepository;
  private readonly calendarRepo: CalendarRepository;
  private readonly deviceRepo: DeviceRepository;
  private readonly calendarRead: CalendarReadService;
  private readonly calendarService: CalendarService;
  private readonly auditRepo: AuditRepository;
  private readonly sourceIdentityRepo: SourceIdentityRepository;
  private readonly invitationRepo: InvitationRepository;
  private readonly invitationService: InvitationService;
  private readonly sessionRepo: SessionRepository;

  constructor(deps: AdminServiceDeps) {
    this.config = deps.config;
    this.userRepo = new UserRepository(deps.db);
    this.calendarRepo = deps.calendarRepo;
    this.deviceRepo = deps.deviceRepo;
    this.calendarRead = deps.calendarRead;
    this.calendarService = deps.calendar;
    this.auditRepo = new AuditRepository(deps.db);
    this.sourceIdentityRepo = new SourceIdentityRepository(deps.db);
    this.invitationRepo = new InvitationRepository(deps.db);
    this.invitationService = deps.invitation;
    this.sessionRepo = new SessionRepository(deps.db);
  }

  async getDashboard() {
    const [users, pendingInvites, recentLogs] = await Promise.all([
      this.userRepo.countByAccountStatus(),
      this.invitationRepo.countPendingUnused(),
      this.auditRepo.listRecent(8),
    ]);
    return {
      users,
      invitations: { pending: pendingInvites },
      recentAudit: await this.enrichAuditLogs(recentLogs),
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
            timezone: calendar.timezone,
            revision: calendar.revision,
            lastSyncedAt: calendar.lastSyncedAt,
            lastChangedAt: calendar.lastChangedAt,
          }
        : null,
      sourceIdentity,
    };
  }

  async updateUser(
    actor: UserRecord,
    userId: string,
    input: {
      displayName?: string;
      maxDevices?: number;
      syncEnabled?: boolean;
      feedEnabled?: boolean;
    },
    requestId?: string,
  ) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const updated = await this.userRepo.updateUser(userId, input, nowIso());
    if (input.displayName !== undefined || input.maxDevices !== undefined) {
      await this.audit(
        actor,
        userId,
        'user.update',
        {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.maxDevices !== undefined ? { maxDevices: input.maxDevices } : {}),
        },
        requestId,
      );
    }
    if (input.syncEnabled !== undefined) {
      await this.audit(
        actor,
        userId,
        input.syncEnabled ? 'user.enable_sync' : 'user.disable_sync',
        {},
        requestId,
      );
    }
    if (input.feedEnabled !== undefined) {
      await this.audit(
        actor,
        userId,
        input.feedEnabled ? 'user.enable_feed' : 'user.disable_feed',
        {},
        requestId,
      );
    }
    return { user: this.publicUser(updated!) };
  }

  async suspendUser(actor: UserRecord, userId: string, requestId?: string) {
    return this.setAccountStatus(actor, userId, 'suspended', 'user.suspend', requestId);
  }

  async activateUser(actor: UserRecord, userId: string, requestId?: string) {
    return this.setAccountStatus(actor, userId, 'active', 'user.activate', requestId);
  }

  async getUserTimetable(userId: string, from?: string, until?: string) {
    const calendar = await this.requireCalendar(userId);
    return this.calendarRead.listTimetable(calendar.id, from, until);
  }

  async getUserSyncRuns(userId: string, limit = 20) {
    const calendar = await this.requireCalendar(userId);
    return this.calendarRead.listSyncRuns(calendar.id, userId, limit);
  }

  async getUserDevices(userId: string) {
    await this.requireUser(userId);
    return this.calendarRead.listDevices(userId, { includeTimestamps: true });
  }

  async revokeDevice(actor: UserRecord, deviceId: string, requestId?: string) {
    const device = await this.deviceRepo.findDeviceOwner(deviceId);
    if (!device) {
      throw new AppError('INVALID_REQUEST', 'Device not found.', 404);
    }
    const revoked = await this.deviceRepo.revokeDeviceById(deviceId, nowIso());
    if (!revoked) {
      throw new AppError('INVALID_REQUEST', 'Device not found.', 404);
    }
    await this.audit(
      actor,
      device.ownerUserId,
      'device.revoke',
      { deviceId, deviceName: device.name },
      requestId,
    );
    return { ok: true };
  }

  async resetSourceIdentity(
    actor: UserRecord,
    userId: string,
    confirmName: string,
    requestId?: string,
  ) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    if (confirmName !== user.displayName) {
      throw new AppError('INVALID_REQUEST', 'Confirmation name does not match.', 400);
    }
    const calendar = await this.requireCalendar(userId);
    const now = nowIso();
    await this.sourceIdentityRepo.resetIdentity(calendar.id, actor.id, now);
    const revokedCount = await this.deviceRepo.revokeAllForOwner(userId, now);
    await this.audit(actor, userId, 'source_identity.reset', { revokedDevices: revokedCount }, requestId);
    return { ok: true, revokedDevices: revokedCount };
  }

  async rotateCalendarToken(actor: UserRecord, userId: string, requestId?: string) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const calendar = await this.requireCalendar(userId);
    const newToken = await this.calendarService.rotateCalendarToken(calendar.id);
    await this.audit(actor, userId, 'calendar.rotate_token', {}, requestId);
    return {
      calendarUrl: `${this.config.publicBaseUrl}/calendar/${newToken}.ics`,
    };
  }

  async createInvitation(
    actor: UserRecord,
    input: Parameters<InvitationService['createInvitation']>[1],
    requestId?: string,
  ) {
    const result = await this.invitationService.createInvitation(actor, input);
    await this.audit(actor, null, 'invitation.create', { invitationId: result.invitationId }, requestId);
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

  async deleteInvitation(actor: UserRecord, invitationId: string, requestId?: string) {
    const deleted = await this.invitationRepo.deleteUnused(invitationId);
    if (!deleted) {
      throw new AppError('INVALID_REQUEST', 'Invitation not found or already used.', 404);
    }
    await this.audit(actor, null, 'invitation.delete', { invitationId }, requestId);
    return { ok: true };
  }

  async listAuditLogs(limit = 50, action?: string) {
    const logs = await this.auditRepo.listRecent(limit, action);
    return { logs: await this.enrichAuditLogs(logs) };
  }

  private async enrichAuditLogs(
    logs: Awaited<ReturnType<AuditRepository['listRecent']>>,
  ) {
    const userIds = [
      ...new Set(
        logs.flatMap((log) => [log.actorUserId, log.targetUserId].filter(Boolean) as string[]),
      ),
    ];
    const users = await Promise.all(userIds.map((id) => this.userRepo.findById(id)));
    const nameById = new Map(
      users.filter(Boolean).map((user) => [user!.id, user!.displayName] as const),
    );
    return logs.map((log) => ({
      ...log,
      actorDisplayName: log.actorUserId ? (nameById.get(log.actorUserId) ?? null) : null,
      targetDisplayName: log.targetUserId ? (nameById.get(log.targetUserId) ?? null) : null,
    }));
  }

  private async setAccountStatus(
    actor: UserRecord,
    userId: string,
    status: UserRecord['accountStatus'],
    action: string,
    requestId?: string,
  ) {
    const user = await this.requireUser(userId);
    this.assertCanManage(actor, user);
    const updated = await this.userRepo.updateUser(userId, { accountStatus: status }, nowIso());
    if (status !== 'active') {
      await this.deviceRepo.revokeAllForOwner(userId, nowIso());
      await this.sessionRepo.deleteByUserId(userId);
    }
    await this.audit(actor, userId, action, {}, requestId);
    return { user: this.publicUser(updated!) };
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new AppError('INVALID_REQUEST', 'User not found.', 404);
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
    requestId?: string | null,
  ) {
    await this.auditRepo.write({
      actorUserId: actor.id,
      actorType: actor.role,
      targetUserId,
      action,
      requestId: requestId ?? null,
      metadata,
    });
  }
}
