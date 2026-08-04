import type { FastifyPluginAsync } from 'fastify';
import { createAdminService } from '../../services/service-factories.js';

interface AdminUserPatchBody {
  displayName?: string;
  maxDevices?: number;
  syncEnabled?: boolean;
  feedEnabled?: boolean;
}

interface AdminInvitationBody {
  expectedName?: string;
  note?: string;
  syncEnabled?: boolean;
  feedEnabled?: boolean;
  maxDevices?: number;
  expiresInHours?: number;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const admin = createAdminService(app.db.admin, app.config, app.tokenService);

  app.get('/api/admin/dashboard', { preHandler: app.authenticateAdmin }, async () =>
    admin.getDashboard(),
  );

  app.get('/api/admin/users', { preHandler: app.authenticateAdmin }, async () =>
    admin.listUsers(),
  );

  app.get<{ Params: { userId: string } }>(
    '/api/admin/users/:userId',
    { preHandler: app.authenticateAdmin },
    async (request) => admin.getUser(request.params.userId),
  );

  app.patch<{ Params: { userId: string }; Body: AdminUserPatchBody }>(
    '/api/admin/users/:userId',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.updateUser(request.user!, request.params.userId, request.body ?? {}, request.requestId),
  );

  app.get<{ Params: { userId: string }; Querystring: { from?: string; until?: string } }>(
    '/api/admin/users/:userId/timetable',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.getUserTimetable(request.params.userId, request.query.from, request.query.until),
  );

  app.get<{ Params: { userId: string }; Querystring: { limit?: string } }>(
    '/api/admin/users/:userId/sync-runs',
    { preHandler: app.authenticateAdmin },
    async (request) => {
      const limit = Number.parseInt(request.query.limit ?? '20', 10);
      return admin.getUserSyncRuns(
        request.params.userId,
        Number.isNaN(limit) ? 20 : limit,
      );
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/devices',
    { preHandler: app.authenticateAdmin },
    async (request) => admin.getUserDevices(request.params.userId),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/suspend',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.suspendUser(request.user!, request.params.userId, request.requestId),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/activate',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.activateUser(request.user!, request.params.userId, request.requestId),
  );

  app.post<{ Params: { userId: string }; Body: { confirmName?: string } }>(
    '/api/admin/users/:userId/reset-source-identity',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.resetSourceIdentity(
        request.user!,
        request.params.userId,
        request.body?.confirmName ?? '',
        request.requestId,
      ),
  );

  app.post<{ Params: { userId: string } }>(
    '/api/admin/users/:userId/rotate-calendar-token',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.rotateCalendarToken(request.user!, request.params.userId, request.requestId),
  );

  app.post<{ Params: { deviceId: string } }>(
    '/api/admin/devices/:deviceId/revoke',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.revokeDevice(request.user!, request.params.deviceId, request.requestId),
  );

  app.post<{ Body: AdminInvitationBody }>(
    '/api/admin/invitations',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.createInvitation(request.user!, request.body ?? {}, request.requestId),
  );

  app.get('/api/admin/invitations', { preHandler: app.authenticateAdmin }, async () =>
    admin.listInvitations(),
  );

  app.delete<{ Params: { invitationId: string } }>(
    '/api/admin/invitations/:invitationId',
    { preHandler: app.authenticateAdmin },
    async (request) =>
      admin.deleteInvitation(request.user!, request.params.invitationId, request.requestId),
  );

  app.get<{ Querystring: { limit?: string; action?: string } }>(
    '/api/admin/audit-logs',
    { preHandler: app.authenticateAdmin },
    async (request) => {
      const limit = Number.parseInt(request.query.limit ?? '50', 10);
      return admin.listAuditLogs(Number.isNaN(limit) ? 50 : limit, request.query.action);
    },
  );
};
