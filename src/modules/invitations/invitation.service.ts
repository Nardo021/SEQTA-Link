import { randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import { InvitationRepository } from './invitation.repository.js';
import type { TokenService } from '../../security/token.service.js';

export class InvitationService {
  private readonly invitationRepo: InvitationRepository;

  constructor(
    db: DbClient,
    private readonly config: AppConfig,
    private readonly tokenService: TokenService,
  ) {
    this.invitationRepo = new InvitationRepository(db);
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
      tokenHash: this.tokenService.hashInvite(rawToken),
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
    const invitation = await this.invitationRepo.findByTokenHash(
      this.tokenService.hashInvite(rawToken),
    );
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
}
