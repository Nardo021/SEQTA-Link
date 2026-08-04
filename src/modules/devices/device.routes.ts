import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { registerSyncEndpoints } from '../sync/sync-handlers.js';
import { createScopedServices } from '../../services/scoped-services.js';

export const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { code?: string; deviceName?: string } }>(
    '/api/device/pair',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '10 minutes',
        },
      },
    },
    async (request) => {
      const code = request.body?.code?.trim();
      if (!code) {
        throw new AppError('INVALID_REQUEST', 'Pairing code is required.', 400);
      }
      const { pairing } = createScopedServices(app.db.device, app.config, app.tokenService);
      return pairing.pairDevice({
        rawCode: code,
        deviceName: request.body?.deviceName?.trim() || 'Browser',
      });
    },
  );

  registerSyncEndpoints(app, {
    statusPath: '/api/device/status',
    syncPath: '/api/device/sync',
    preHandler: app.authenticateDevice,
    rateLimitKey: (request) => request.syncContext?.device.id ?? request.ip,
  });
};
