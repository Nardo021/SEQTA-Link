import type { FastifyPluginAsync } from 'fastify';
import { createScopedServices } from '../../services/scoped-services.js';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const admin = (handler: (services: ReturnType<typeof createScopedServices>) => Promise<unknown>) =>
    handler(createScopedServices(app.db.admin, app.config, app.tokenService));

  app.get('/api/admin/dashboard', { preHandler: app.authenticateAdmin }, async () =>
    admin((services) => services.admin.getDashboard()),
  );

  app.get('/api/admin/users', { preHandler: app.authenticateAdmin }, async () =>
    admin((services) => services.admin.listUsers()),
  );

  app.get<{ Params: { userId: string } }>(
    '/api/admin/users/:userId',
    { preHandler: app.authenticateAdmin },
    async (request) => admin((services) => services.admin.getUser(request.params.userId)),
  );

  app.patch<{ Params: { userId: string }; Body: { displayName?: string; maxDevices?: number } }>(
    '/api/admin/users/:userId',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) =>
        services.admin.updateUser(request.user!, request.params.userId, request.body ?? {}),
      ),
  );

  app.get<{ Params: { userId: string }; Querystring: { from?: string; until?: string } }>(
    '/api/admin/users/:userId/timetable',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) =>
        services.admin.getUserTimetable(request.params.userId, request.query.from, request.query.until),
      ),
  );

  app.get<{ Params: { userId: string }; Querystring: { limit?: string } }>(
    '/api/admin/users/:userId/sync-runs',
    { preHandler: app.authenticateAdmin },
    async (request) => {
      const limit = Number.parseInt(request.query.limit ?? '20', 10);
      return admin((services) =>
        services.admin.getUserSyncRuns(request.params.userId, Number.isNaN(limit) ? 20 : limit),
      );
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/devices',
    { preHandler: app.authenticateAdmin },
    async (request) => admin((services) => services.admin.getUserDevices(request.params.userId)),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/suspend',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.suspendUser(request.user!, request.params.userId)),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/activate',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.activateUser(request.user!, request.params.userId)),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/enable-sync',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.setSyncEnabled(request.user!, request.params.userId, true)),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/disable-sync',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.setSyncEnabled(request.user!, request.params.userId, false)),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/enable-feed',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.setFeedEnabled(request.user!, request.params.userId, true)),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/disable-feed',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.setFeedEnabled(request.user!, request.params.userId, false)),
  );

  app.post<{ Params: { userId: string }; Body: { confirmName?: string } }>(
    '/api/admin/users/:userId/reset-source-identity',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) =>
        services.admin.resetSourceIdentity(
          request.user!,
          request.params.userId,
          request.body?.confirmName ?? '',
        ),
      ),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/rotate-calendar-token',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.rotateCalendarToken(request.user!, request.params.userId)),
  );

  app.post<{ Params: { deviceId: string } }>(
    '/api/admin/devices/:deviceId/revoke',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.revokeDevice(request.user!, request.params.deviceId)),
  );

  app.post<{ Body: Record<string, unknown> }>(
    '/api/admin/invitations',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) =>
        services.admin.createInvitation(
          request.user!,
          request.body as {
            expectedName?: string;
            note?: string;
            syncEnabled?: boolean;
            feedEnabled?: boolean;
            maxDevices?: number;
            expiresInHours?: number;
          },
        ),
      ),
  );

  app.get('/api/admin/invitations', { preHandler: app.authenticateAdmin }, async () =>
    admin((services) => services.admin.listInvitations()),
  );

  app.delete<{ Params: { invitationId: string } }>(
    '/api/admin/invitations/:invitationId',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin((services) => services.admin.deleteInvitation(request.user!, request.params.invitationId)),
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/api/admin/audit-logs',
    { preHandler: app.authenticateAdmin },
    async (request) => {
      const limit = Number.parseInt(request.query.limit ?? '50', 10);
      return admin((services) => services.admin.listAuditLogs(Number.isNaN(limit) ? 50 : limit));
    },
  );
};
