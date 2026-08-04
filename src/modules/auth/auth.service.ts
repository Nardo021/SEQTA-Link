import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.js';
import type { DbClient } from '../../db/client.js';
import { nowIso } from '../../shared/dates.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import { provisionUserCalendar } from '../calendars/calendar-provisioning.js';
import type { TokenService } from '../feeds/token.service.js';
import { SessionRepository } from './session.repository.js';
import { UserRepository } from '../users/user.repository.js';
import { OidcClient } from './oidc.client.js';

const SESSION_COOKIE = 'seqta_session';

export class AuthService {
  private readonly sessionRepo: SessionRepository;
  private readonly userRepo: UserRepository;
  private readonly oidc?: OidcClient;

  constructor(
    private readonly db: DbClient,
    private readonly config: AppConfig,
    private readonly tokenService: TokenService,
  ) {
    this.sessionRepo = new SessionRepository(db);
    this.userRepo = new UserRepository(db);
    if (config.oidcIssuer && config.oidcClientId && config.oidcRedirectUri) {
      this.oidc = new OidcClient(config);
    }
  }

  isOidcEnabled(): boolean {
    return Boolean(this.oidc);
  }

  getLoginRedirectUrl(state: string, codeChallenge: string): string {
    if (!this.oidc) {
      throw new AppError('INVALID_REQUEST', 'OIDC is not configured.', 400);
    }
    return this.oidc.buildAuthorizeUrl(state, codeChallenge);
  }

  async handleOidcCallback(code: string, codeVerifier: string): Promise<{ sessionToken: string; user: UserRecord }> {
    if (!this.oidc) {
      throw new AppError('INVALID_REQUEST', 'OIDC is not configured.', 400);
    }
    const claims = await this.oidc.exchangeCode(code, codeVerifier);
    const user = await this.findOrCreateOidcUser(claims);
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
    const subject = `dev:${displayName.toLowerCase().replace(/\s+/g, '-')}`;
    let user = await this.userRepo.findByOidc('dev:', subject);
    if (!user) {
      user = await this.userRepo.createUser({
        id: randomUUID(),
        oidcIssuer: 'dev:',
        oidcSubject: subject,
        displayName,
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

  private async findOrCreateOidcUser(claims: {
    issuer: string;
    subject: string;
    name: string;
    email?: string;
  }): Promise<UserRecord> {
    const existing = await this.userRepo.findByOidc(claims.issuer, claims.subject);
    if (existing) {
      await this.ensureUserCalendar(existing);
      return existing;
    }

    const user = await this.userRepo.createUser({
      id: randomUUID(),
      oidcIssuer: claims.issuer,
      oidcSubject: claims.subject,
      displayName: claims.name,
      email: claims.email ?? null,
      role: 'user',
      now: nowIso(),
    });

    await this.ensureUserCalendar(user);
    return user;
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
