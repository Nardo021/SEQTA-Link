import type { FastifyPluginAsync } from 'fastify';
import { createScopedServices } from '../../services/scoped-services.js';

export const invitationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>('/api/invite/:token', async (request) => {
    const { invitation } = createScopedServices(app.db.user, app.config, app.tokenService);
    return invitation.getInvitationPreview(request.params.token);
  });

  app.post<{ Params: { token: string } }>(
    '/api/invite/:token/accept',
    { preHandler: app.authenticateSession },
    async (request) => {
      const { invitation } = createScopedServices(app.db.user, app.config, app.tokenService);
      const user = await invitation.acceptInvitation(request.user!, request.params.token);
      return {
        user: {
          id: user.id,
          displayName: user.displayName,
          syncEnabled: user.syncEnabled,
          feedEnabled: user.feedEnabled,
        },
      };
    },
  );
};
