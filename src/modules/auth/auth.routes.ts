import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { readSessionToken } from './auth.service.js';
import { createPkcePair } from './oidc.client.js';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';

const pendingPkce = new Map<string, { verifier: string; expiresAt: number }>();

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth/login', async (request, reply) => {
    if (app.authService.isOidcEnabled()) {
      const state = randomBytes(16).toString('base64url');
      const pkce = createPkcePair();
      pendingPkce.set(state, { verifier: pkce.verifier, expiresAt: Date.now() + 10 * 60 * 1000 });
      const url = app.authService.getLoginRedirectUrl(state, pkce.challenge);
      return reply.redirect(url);
    }
    return reply.redirect('/app/login.html');
  });

  app.get('/auth/oidc/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    if (!query.code || !query.state) {
      throw new AppError('INVALID_REQUEST', 'Missing OIDC callback parameters.', 400);
    }
    const pending = pendingPkce.get(query.state);
    pendingPkce.delete(query.state);
    if (!pending || pending.expiresAt < Date.now()) {
      throw new AppError('INVALID_REQUEST', 'OIDC state expired.', 400);
    }
    const { sessionToken } = await app.authService.handleOidcCallback(query.code, pending.verifier);
    reply.setCookie(
      app.authService.getSessionCookieName(),
      sessionToken,
      app.authService.getSessionCookieOptions(),
    );
    return reply.redirect('/app/dashboard.html');
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = readSessionToken(request.headers.cookie, app.authService.getSessionCookieName());
    await app.authService.logout(token);
    reply.clearCookie(app.authService.getSessionCookieName(), { path: '/' });
    return { ok: true };
  });

  app.post<{ Body: { displayName?: string; role?: UserRecord['role'] } }>(
    '/auth/dev-login',
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
