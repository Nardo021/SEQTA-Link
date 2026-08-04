import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { resolveUploadTokenContext } from '../db/token-resolve.js';
import { AuthService, readSessionToken } from '../modules/auth/auth.service.js';
import { ensureOwnerBootstrapFromConfig } from '../modules/auth/owner-bootstrap.js';
import { AppError } from '../shared/errors.js';
import type { TokenType, UserRecord } from '../shared/types.js';
import { withBruteForce, isAuthFailure } from '../security/with-brute-force.js';

const authenticationPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('syncContext', undefined);
  app.decorateRequest('rawToken', undefined);
  app.decorateRequest('tokenType', undefined);
  app.decorateRequest('user', undefined);
  app.decorateRequest('calendar', undefined);

  const authService = new AuthService(app.db.user, app.config, app.tokenService);
  app.decorate('authService', authService);

  const owner = await ensureOwnerBootstrapFromConfig(
    app.db.cli,
    app.config,
    app.tokenService,
  );
  if (owner) {
    app.log.info({ event: 'owner_bootstrap_ensured', email: owner.email, userId: owner.id });
  }

  async function requireSessionUser(request: FastifyRequest): Promise<UserRecord> {
    const token = readSessionToken(request.headers.cookie, authService.getSessionCookieName());
    const user = await authService.validateSessionToken(token);
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
    }
    return user;
  }

  app.decorate(
    'authenticateSyncToken',
    async (request: FastifyRequest): Promise<void> => {
      await withBruteForce(
        app.bruteForce,
        app.bruteForcePolicies.apiAuth,
        [{ scope: 'sync-auth-ip', key: request.ip }],
        {
          shouldRecordFailure: isAuthFailure,
          run: async () => {
            const { rawToken, type } = app.tokenService.parseBearerToken(
              request.headers.authorization,
              ['upload', 'device'],
            );
            const purpose: 'upload' | 'device' = type === 'device' ? 'device' : 'upload';
            const hash = app.tokenService.hash(purpose, rawToken);
            const syncContext = await resolveUploadTokenContext(app.db.device, hash, {
              requireSyncEnabled: true,
            });

            request.rawToken = rawToken;
            request.tokenType = type as TokenType;
            request.syncContext = syncContext;
            request.calendar = syncContext.calendar;
          },
        },
      );
    },
  );

  app.decorate(
    'authenticateSession',
    async (request: FastifyRequest): Promise<void> => {
      request.user = await requireSessionUser(request);
    },
  );

  app.decorate(
    'authenticateAdmin',
    async (request: FastifyRequest): Promise<void> => {
      const user = await requireSessionUser(request);
      if (user.role !== 'owner' && user.role !== 'admin') {
        throw new AppError('FORBIDDEN', 'Forbidden.', 403);
      }
      request.user = user;
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    authenticateSyncToken: (request: FastifyRequest) => Promise<void>;
    authenticateSession: (request: FastifyRequest) => Promise<void>;
    authenticateAdmin: (request: FastifyRequest) => Promise<void>;
    authService: AuthService;
  }

  interface FastifyRequest {
    user?: UserRecord;
    tokenType?: TokenType;
  }
}

export default fp(authenticationPlugin, {
  name: 'authentication',
  dependencies: ['services', 'brute-force'],
});
