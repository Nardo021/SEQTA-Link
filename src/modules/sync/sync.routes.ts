import type { FastifyPluginAsync } from 'fastify';
import { registerSyncEndpoints } from './sync-handlers.js';

export const syncRoutes: FastifyPluginAsync = async (app) => {
  registerSyncEndpoints(app, {
    statusPath: '/api/v1/status',
    syncPath: '/api/v1/sync',
    preHandler: app.authenticateUpload,
    rateLimitKey: (request) => request.syncContext?.calendar.id ?? request.ip,
    logSyncEvents: true,
  });
};
