import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors.js';
import type { UserRecord } from '../../shared/types.js';
import { createMeService } from '../../services/service-factories.js';

export const meRoutes: FastifyPluginAsync = async (app) => {
  const withMe = (
    request: FastifyRequest,
    handler: (me: ReturnType<typeof createMeService>, user: UserRecord) => Promise<unknown>,
  ) => {
    const user = request.user!;
    return app.db.user.withUserContext(user.id, async (client) =>
      handler(createMeService(client, app.config, app.tokenService), user),
    );
  };

  app.get('/api/me', { preHandler: app.authenticateSession }, async (request) =>
    withMe(request, (me, user) => me.getMe(user)),
  );

  app.get('/api/me/dashboard', { preHandler: app.authenticateSession }, async (request) =>
    withMe(request, (me, user) => me.getDashboard(user)),
  );

  app.get<{ Querystring: { from?: string; until?: string } }>(
    '/api/me/timetable',
    { preHandler: app.authenticateSession },
    async (request) =>
      withMe(request, (me, user) => me.getTimetable(user, request.query.from, request.query.until)),
  );

  app.get('/api/me/calendar', { preHandler: app.authenticateSession }, async (request) =>
    withMe(request, (me, user) => me.getCalendar(user)),
  );

  app.post('/api/me/calendar/rotate-token', { preHandler: app.authenticateSession }, async (request) =>
    withMe(request, (me, user) => me.rotateCalendarToken(user)),
  );

  app.get('/api/me/devices', { preHandler: app.authenticateSession }, async (request) =>
    withMe(request, (me, user) => me.listDevices(user)),
  );

  app.get('/api/me/pairing-codes', { preHandler: app.authenticateSession }, async (request) =>
    withMe(request, (me, user) => me.listPairingCodes(user)),
  );

  app.post('/api/me/pairing-codes', { preHandler: app.authenticateSession }, async (request) =>
    withMe(request, (me, user) => me.createPairingCode(user)),
  );

  app.delete<{ Params: { pairingCodeId: string } }>(
    '/api/me/pairing-codes/:pairingCodeId',
    { preHandler: app.authenticateSession },
    async (request) =>
      withMe(request, async (me, user) => {
        await me.revokePairingCode(user, request.params.pairingCodeId);
        return { ok: true };
      }),
  );

  app.delete<{ Params: { deviceId: string } }>(
    '/api/me/devices/:deviceId',
    { preHandler: app.authenticateSession },
    async (request) =>
      withMe(request, async (me, user) => {
        await me.revokeDevice(user, request.params.deviceId);
        return { ok: true };
      }),
  );

  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    '/api/me/password',
    { preHandler: app.authenticateSession },
    async (request, reply) => {
      const currentPassword = request.body?.currentPassword ?? '';
      const newPassword = request.body?.newPassword ?? '';
      if (!currentPassword || !newPassword) {
        throw new AppError('INVALID_REQUEST', 'Current and new password are required.', 400);
      }
      await app.authService.changePassword(request.user!.id, currentPassword, newPassword);
      reply.clearCookie(app.authService.getSessionCookieName(), { path: '/' });
      return { ok: true, reauthRequired: true };
    },
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/api/me/sync-runs',
    { preHandler: app.authenticateSession },
    async (request) => {
      const limit = Number.parseInt(request.query.limit ?? '20', 10);
      return withMe(request, (me, user) => me.listSyncRuns(user, Number.isNaN(limit) ? 20 : limit));
    },
  );

  app.patch<{ Body: { calendarName?: string } }>(
    '/api/me/preferences',
    { preHandler: app.authenticateSession },
    async (request) =>
      withMe(request, (me, user) => me.updatePreferences(user, request.body ?? {})),
  );
};
