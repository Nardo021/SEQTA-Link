import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import {
  assertPasswordPolicy,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from '../../shared/password.js';
import type { UserRecord } from '../../shared/types.js';
import { provisionUserCalendar } from '../calendars/calendar-provisioning.js';
import type { TokenService } from '../../security/token.service.js';
import { InvitationRepository } from '../invitations/invitation.repository.js';
import { SessionRepository } from './session.repository.js';
import { UserRepository } from '../users/user.repository.js';

const SESSION_COOKIE = 'seqta_session';

export class AuthService {
  private readonly sessionRepo: SessionRepository;
  private readonly userRepo: UserRepository;
  private readonly invitationRepo: InvitationRepository;

  constructor(
    private readonly db: DbClient,
    private readonly config: AppConfig,
    private readonly tokenService: TokenService,
  ) {
    this.sessionRepo = new SessionRepository(db);
    this.userRepo = new UserRepository(db);
    this.invitationRepo = new InvitationRepository(db);
  }

  async login(
    emailRaw: string,
    password: string,
  ): Promise<{ sessionToken: string; user: UserRecord }> {
    const email = normalizeEmail(emailRaw);
    if (!email || !password) {
      throw new AppError('UNAUTHORIZED', 'Invalid email or password.', 401);
    }

    const user = await this.userRepo.findByEmail(email);
    if (!user || user.accountStatus !== 'active') {
      throw new AppError('UNAUTHORIZED', 'Invalid email or password.', 401);
    }

    const passwordHash = await this.userRepo.getPasswordHash(user.id);
    if (!passwordHash || !verifyPassword(password, passwordHash)) {
      throw new AppError('UNAUTHORIZED', 'Invalid email or password.', 401);
    }

    await this.ensureUserCalendar(user);
    const sessionToken = await this.createSession(user.id);
    return { sessionToken, user };
  }

  async registerWithInvitation(
    rawToken: string,
    input: { email: string; password: string; displayName?: string },
  ): Promise<{ sessionToken: string; user: UserRecord }> {
    const email = normalizeEmail(input.email);
    if (!email || !email.includes('@')) {
      throw new AppError('INVALID_REQUEST', 'A valid email is required.', 400);
    }

    try {
      assertPasswordPolicy(input.password);
    } catch (error) {
      throw new AppError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid password.',
        400,
      );
    }

    const tokenHash = this.tokenService.hashInvite(rawToken);
    const user = await this.db.transaction(async (tx) => {
      const invitationRepo = new InvitationRepository(tx);
      const userRepo = new UserRepository(tx);

      const invitation = await invitationRepo.lockByTokenHash(tokenHash);
      if (!invitation || invitation.usedAt) {
        throw new AppError('INVALID_REQUEST', 'Invitation not found.', 404);
      }
      if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
        throw new AppError('INVALID_REQUEST', 'Invitation has expired.', 404);
      }

      const existing = await userRepo.findByEmail(email);
      if (existing) {
        throw new AppError('INVALID_REQUEST', 'An account with this email already exists.', 409);
      }

      const now = nowIso();
      const displayName =
        input.displayName?.trim() ||
        invitation.expectedName?.trim() ||
        email.split('@')[0] ||
        'User';

      const created = await userRepo.createUser({
        id: randomUUID(),
        displayName,
        email,
        passwordHash: hashPassword(input.password),
        role: 'user',
        syncEnabled: invitation.syncEnabled,
        feedEnabled: invitation.feedEnabled,
        maxDevices: invitation.maxDevices,
        now,
      });

      const marked = await invitationRepo.markUsed(invitation.id, created.id, now);
      if (!marked) {
        throw new AppError('INVALID_REQUEST', 'Invitation already used.', 409);
      }
      return created;
    });

    await this.ensureUserCalendar(user);
    const sessionToken = await this.createSession(user.id);
    return { sessionToken, user };
  }

  async devLogin(
    displayName: string,
    role: UserRecord['role'] = 'user',
  ): Promise<{ sessionToken: string; user: UserRecord }> {
    if (!this.config.authDevLoginEnabled) {
      throw new AppError('FORBIDDEN', 'Dev login is disabled.', 403);
    }
    const slug = displayName.toLowerCase().replace(/\s+/g, '-') || 'dev-user';
    const email = `dev-${slug}@local.test`;
    let user = await this.userRepo.findByEmail(email);
    if (!user) {
      user = await this.userRepo.createUser({
        id: randomUUID(),
        displayName,
        email,
        passwordHash: hashPassword(randomBytes(24).toString('base64url')),
        role,
        now: nowIso(),
      });
    } else if (user.role !== role) {
      user = (await this.userRepo.updateUser(user.id, { role }, nowIso()))!;
    }

    await this.ensureUserCalendar(user);
    const sessionToken = await this.createSession(user.id);
    return { sessionToken, user };
  }

  async validateSessionToken(sessionToken: string | undefined): Promise<UserRecord | null> {
    if (!sessionToken) {
      return null;
    }
    const tokenHash = this.hashSessionToken(sessionToken);
    const session = await this.sessionRepo.findByTokenHash(tokenHash);
    if (!session) {
      return null;
    }
    const user = await this.userRepo.findById(session.userId);
    if (!user || user.accountStatus !== 'active') {
      return null;
    }
    await this.sessionRepo.touchSession(session.id, nowIso());
    return user;
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (!sessionToken) {
      return;
    }
    await this.sessionRepo.deleteByTokenHash(this.hashSessionToken(sessionToken));
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.sessionRepo.deleteByUserId(userId);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    try {
      assertPasswordPolicy(newPassword);
    } catch (error) {
      throw new AppError(
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid password.',
        400,
      );
    }

    const passwordHash = await this.userRepo.getPasswordHash(userId);
    if (!passwordHash || !verifyPassword(currentPassword, passwordHash)) {
      throw new AppError('UNAUTHORIZED', 'Current password is incorrect.', 401);
    }

    await this.userRepo.updateUser(
      userId,
      { passwordHash: hashPassword(newPassword) },
      nowIso(),
    );
    await this.revokeAllSessions(userId);
  }

  getSessionCookieName(): string {
    return SESSION_COOKIE;
  }

  getSessionCookieOptions(): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'lax';
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.sessionTtlHours * 60 * 60,
    };
  }

  private async createSession(userId: string): Promise<string> {
    const sessionToken = randomBytes(32).toString('base64url');
    const now = nowIso();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000).toISOString();
    await this.sessionRepo.createSession({
      id: randomUUID(),
      userId,
      tokenHash: this.hashSessionToken(sessionToken),
      expiresAt,
      now,
    });
    return sessionToken;
  }

  private hashSessionToken(token: string): string {
    return createHash('sha256')
      .update(this.config.sessionSecret)
      .update(token)
      .digest('hex');
  }

  private async ensureUserCalendar(user: UserRecord): Promise<void> {
    await this.db.withUserContext(user.id, async (client) => {
      await provisionUserCalendar(client, this.config, this.tokenService, user);
    });
  }
}

export function readSessionToken(cookieHeader: string | undefined, cookieName: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return undefined;
}
