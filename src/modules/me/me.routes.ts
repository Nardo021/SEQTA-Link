import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { UserRecord } from '../../shared/types.js';
import { createScopedServices } from '../../services/scoped-services.js';

export const meRoutes: FastifyPluginAsync = async (app) => {
  const me = (
    request: FastifyRequest,
    handler: (services: ReturnType<typeof createScopedServices>, user: UserRecord) => Promise<unknown>,
  ) => {
    const user = request.user!;
    return app.db.user.withUserContext(user.id, async (client) =>
      handler(createScopedServices(client, app.config, app.tokenService), user),
    );
  };

  app.get('/api/me', { preHandler: app.authenticateSession }, async (request) =>
    me(request, (services, user) => services.me.getMe(user)),
  );

  app.get('/api/me/dashboard', { preHandler: app.authenticateSession }, async (request) =>
    me(request, (services, user) => services.me.getDashboard(user)),
  );

  app.get<{ Querystring: { from?: string; until?: string } }>(
    '/api/me/timetable',
    { preHandler: app.authenticateSession },
    async (request) =>
      me(request, (services, user) =>
        services.me.getTimetable(user, request.query.from, request.query.until),
      ),
  );

  app.get('/api/me/calendar', { preHandler: app.authenticateSession }, async (request) =>
    me(request, (services, user) => services.me.getCalendar(user)),
  );

  app.post('/api/me/calendar/rotate-token', { preHandler: app.authenticateSession }, async (request) =>
    me(request, (services, user) => services.me.rotateCalendarToken(user)),
  );

  app.get('/api/me/devices', { preHandler: app.authenticateSession }, async (request) =>
    me(request, (services, user) => services.me.listDevices(user)),
  );

  app.post('/api/me/pairing-codes', { preHandler: app.authenticateSession }, async (request) =>
    me(request, (services, user) => services.me.createPairingCode(user)),
  );

  app.delete<{ Params: { deviceId: string } }>(
    '/api/me/devices/:deviceId',
    { preHandler: app.authenticateSession },
    async (request) =>
      me(request, async (services, user) => {
        await services.me.revokeDevice(user, request.params.deviceId);
        return { ok: true };
      }),
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/api/me/sync-runs',
    { preHandler: app.authenticateSession },
    async (request) => {
      const limit = Number.parseInt(request.query.limit ?? '20', 10);
      return me(request, (services, user) =>
        services.me.listSyncRuns(user, Number.isNaN(limit) ? 20 : limit),
      );
    },
  );

  app.patch<{ Body: { calendarName?: string } }>(
    '/api/me/preferences',
    { preHandler: app.authenticateSession },
    async (request) =>
      me(request, (services, user) => services.me.updatePreferences(user, request.body ?? {})),
  );
};
