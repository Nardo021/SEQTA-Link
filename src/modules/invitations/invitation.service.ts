import { randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import { provisionUserCalendar } from '../calendars/calendar-provisioning.js';
import { InvitationRepository } from './invitation.repository.js';
import type { TokenService } from '../feeds/token.service.js';
import { UserRepository } from '../users/user.repository.js';

export class InvitationService {
  private readonly invitationRepo: InvitationRepository;
  private readonly userRepo: UserRepository;

  constructor(
    private readonly db: DbClient,
    private readonly config: AppConfig,
    private readonly tokenService: TokenService,
  ) {
    this.invitationRepo = new InvitationRepository(db);
    this.userRepo = new UserRepository(db);
  }

  hashInviteToken(rawToken: string): string {
    return this.tokenService.hash('device', `invite:${rawToken}`);
  }

  async createInvitation(
    actor: UserRecord,
    input: {
      expectedName?: string;
      note?: string;
      syncEnabled?: boolean;
      feedEnabled?: boolean;
      maxDevices?: number;
      expiresInHours?: number;
    },
  ): Promise<{ inviteUrl: string; expiresAt: string; invitationId: string }> {
    const rawToken = randomBytes(32).toString('base64url');
    const now = nowIso();
    const hours = input.expiresInHours ?? 72;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const id = randomUUID();
    await this.invitationRepo.create({
      id,
      tokenHash: this.hashInviteToken(rawToken),
      createdBy: actor.id,
      expectedName: input.expectedName ?? null,
      note: input.note ?? null,
      syncEnabled: input.syncEnabled ?? true,
      feedEnabled: input.feedEnabled ?? true,
      maxDevices: input.maxDevices ?? 3,
      expiresAt,
      now,
    });
    return {
      invitationId: id,
      inviteUrl: `${this.config.publicBaseUrl}/invite.html?token=${rawToken}`,
      expiresAt,
    };
  }

  async getInvitationPreview(rawToken: string) {
    const invitation = await this.invitationRepo.findByTokenHash(this.hashInviteToken(rawToken));
    if (!invitation || invitation.usedAt) {
      throw new AppError('INVALID_REQUEST', 'Invitation not found.', 404);
    }
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      throw new AppError('INVALID_REQUEST', 'Invitation has expired.', 404);
    }
    return {
      expectedName: invitation.expectedName,
      expiresAt: invitation.expiresAt,
      syncEnabled: invitation.syncEnabled,
      feedEnabled: invitation.feedEnabled,
    };
  }

  async acceptInvitation(user: UserRecord, rawToken: string): Promise<UserRecord> {
    const invitation = await this.invitationRepo.findByTokenHash(this.hashInviteToken(rawToken));
    if (!invitation || invitation.usedAt) {
      throw new AppError('INVALID_REQUEST', 'Invitation not found.', 404);
    }
    if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
      throw new AppError('INVALID_REQUEST', 'Invitation has expired.', 404);
    }

    const now = nowIso();
    const updated = await this.userRepo.applyInvitationSettings(user.id, {
      syncEnabled: invitation.syncEnabled,
      feedEnabled: invitation.feedEnabled,
      maxDevices: invitation.maxDevices,
      displayName: invitation.expectedName ?? user.displayName,
    }, now);
    if (!updated) {
      throw new AppError('INTERNAL_ERROR', 'Failed to apply invitation.', 500);
    }

    await this.db.withUserContext(user.id, async (client) => {
      await provisionUserCalendar(client, this.config, this.tokenService, updated);
    });

    const marked = await this.invitationRepo.markUsed(invitation.id, user.id, now);
    if (!marked) {
      throw new AppError('INVALID_REQUEST', 'Invitation already used.', 409);
    }
    return (await this.userRepo.findById(user.id))!;
  }
}
