import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { isNotFound, withBruteForce } from '../../security/with-brute-force.js';
import { InvitationService } from './invitation.service.js';

export const invitationRoutes: FastifyPluginAsync = async (app) => {
  const registerWindow = `${app.config.authRegisterWindowMinutes} minutes`;
  const failureDelayMs = app.config.nodeEnv === 'test' ? 0 : 250;
  const invitations = new InvitationService(app.db.user, app.config, app.tokenService);

  app.get<{ Params: { token: string } }>(
    '/api/invite/:token',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: registerWindow,
        },
      },
    },
    async (request) =>
      withBruteForce(
        app.bruteForce,
        app.bruteForcePolicies.register,
        [
          { scope: 'register-ip', key: request.ip },
          { scope: 'register-token', key: request.params.token },
        ],
        {
          clearOnSuccess: false,
          shouldRecordFailure: isNotFound,
          run: () => invitations.getInvitationPreview(request.params.token),
        },
      ),
  );

  app.post<{
    Params: { token: string };
    Body: { email?: string; password?: string; displayName?: string };
  }>(
    '/api/invite/:token/accept',
    {
      config: {
        rateLimit: {
          max: app.config.authRegisterRateLimitMax,
          timeWindow: registerWindow,
        },
      },
    },
    async (request, reply) => {
      const email = request.body?.email?.trim() ?? '';
      const password = request.body?.password ?? '';
      if (!email || !password) {
        throw new AppError('INVALID_REQUEST', 'Email and password are required.', 400);
      }

      const result = await withBruteForce(
        app.bruteForce,
        app.bruteForcePolicies.register,
        [
          { scope: 'register-ip', key: request.ip },
          { scope: 'register-token', key: request.params.token },
        ],
        {
          delayOnFailureMs: failureDelayMs,
          shouldRecordFailure: (error) =>
            error instanceof AppError && (error.statusCode === 404 || error.statusCode === 409),
          run: () =>
            app.authService.registerWithInvitation(request.params.token, {
              email,
              password,
              displayName: request.body?.displayName,
            }),
        },
      );

      reply.setCookie(
        app.authService.getSessionCookieName(),
        result.sessionToken,
        app.authService.getSessionCookieOptions(),
      );

      return {
        ok: true,
        redirect: '/app/dashboard.html',
        user: {
          id: result.user.id,
          displayName: result.user.displayName,
          email: result.user.email,
          syncEnabled: result.user.syncEnabled,
          feedEnabled: result.user.feedEnabled,
        },
      };
    },
  );
};
