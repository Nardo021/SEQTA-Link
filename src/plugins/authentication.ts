import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { resolveUploadTokenContext } from '../db/token-resolve.js';
import { AuthService, readSessionToken } from '../modules/auth/auth.service.js';
import { AppError } from '../shared/errors.js';
import type { UserRecord } from '../shared/types.js';

const authenticationPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('syncContext', undefined);
  app.decorateRequest('rawToken', undefined);
  app.decorateRequest('tokenType', undefined);
  app.decorateRequest('user', undefined);
  app.decorateRequest('calendar', undefined);

  const authService = new AuthService(app.db.user, app.config, app.tokenService);
  app.decorate('authService', authService);

  async function requireSessionUser(request: FastifyRequest): Promise<UserRecord> {
    const token = readSessionToken(request.headers.cookie, authService.getSessionCookieName());
    const user = await authService.validateSessionToken(token);
    if (!user) {
      throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
    }
    return user;
  }

  app.decorate(
    'authenticateUpload',
    async (request: FastifyRequest): Promise<void> => {
      const { rawToken } = app.tokenService.parseUploadBearerToken(request.headers.authorization);
      const hash = app.tokenService.hash('upload', rawToken);
      const syncContext = await resolveUploadTokenContext(app.db.device, hash, {
        requireSyncEnabled: true,
      });

      request.rawToken = rawToken;
      request.tokenType = 'upload';
      request.syncContext = syncContext;
      request.calendar = syncContext.calendar;
      request.feed = syncContext.calendar;
    },
  );

  app.decorate(
    'authenticateDevice',
    async (request: FastifyRequest): Promise<void> => {
      const { rawToken } = app.tokenService.parseDeviceBearerToken(request.headers.authorization);
      const hash = app.tokenService.hash('device', rawToken);
      const syncContext = await resolveUploadTokenContext(app.db.device, hash, {
        requireSyncEnabled: true,
      });

      request.rawToken = rawToken;
      request.tokenType = 'device';
      request.syncContext = syncContext;
      request.calendar = syncContext.calendar;
      request.feed = syncContext.calendar;
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
    authenticateUpload: (request: FastifyRequest) => Promise<void>;
    authenticateDevice: (request: FastifyRequest) => Promise<void>;
    authenticateSession: (request: FastifyRequest) => Promise<void>;
    authenticateAdmin: (request: FastifyRequest) => Promise<void>;
    authService: AuthService;
  }

  interface FastifyRequest {
    user?: UserRecord;
    tokenType?: 'upload' | 'calendar' | 'device';
  }
}

export default fp(authenticationPlugin, {
  name: 'authentication',
  dependencies: ['services'],
});
