import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { isUnauthorizedStatus, withBruteForce } from '../../security/with-brute-force.js';
import type { UserRecord } from '../../shared/types.js';
import { readSessionToken } from './auth.service.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  const loginWindow = `${app.config.authLoginWindowMinutes} minutes`;
  const failureDelayMs = app.config.nodeEnv === 'test' ? 0 : 250;

  app.get('/auth/login', async (_request, reply) => {
    return reply.redirect('/app/login.html');
  });

  app.post<{ Body: { email?: string; password?: string } }>(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: app.config.authLoginRateLimitMax,
          timeWindow: loginWindow,
        },
      },
    },
    async (request, reply) => {
      const email = request.body?.email?.trim() ?? '';
      const password = request.body?.password ?? '';

      const { sessionToken, user } = await withBruteForce(
        app.bruteForce,
        app.bruteForcePolicies.login,
        [
          { scope: 'login-ip', key: request.ip },
          { scope: 'login-email', key: email },
        ],
        {
          delayOnFailureMs: failureDelayMs,
          shouldRecordFailure: isUnauthorizedStatus,
          run: () => app.authService.login(email, password),
        },
      );

      reply.setCookie(
        app.authService.getSessionCookieName(),
        sessionToken,
        app.authService.getSessionCookieOptions(),
      );
      return {
        ok: true,
        redirect:
          user.role === 'owner' || user.role === 'admin'
            ? '/admin/dashboard.html'
            : '/app/dashboard.html',
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
        },
      };
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const token = readSessionToken(request.headers.cookie, app.authService.getSessionCookieName());
    await app.authService.logout(token);
    reply.clearCookie(app.authService.getSessionCookieName(), { path: '/' });
    return { ok: true };
  });

  app.post<{ Body: { displayName?: string; role?: UserRecord['role'] } }>(
    '/auth/dev-login',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const displayName = request.body?.displayName?.trim() || 'Dev User';
      const role = request.body?.role ?? 'user';
      const { sessionToken } = await app.authService.devLogin(displayName, role);
      reply.setCookie(
        app.authService.getSessionCookieName(),
        sessionToken,
        app.authService.getSessionCookieOptions(),
      );
      return { ok: true, redirect: '/app/dashboard.html' };
    },
  );
};
