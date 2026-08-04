import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { withBruteForce } from '../../security/with-brute-force.js';
import { createPairingService } from '../../services/service-factories.js';

export const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { code?: string; deviceName?: string } }>(
    '/api/device/pair',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '10 minutes',
        },
      },
    },
    async (request) => {
      const code = request.body?.code?.trim();
      if (!code) {
        throw new AppError('INVALID_REQUEST', 'Pairing code is required.', 400);
      }
      return withBruteForce(
        app.bruteForce,
        app.bruteForcePolicies.apiAuth,
        [{ scope: 'pair-ip', key: request.ip }],
        {
          shouldRecordFailure: (error) =>
            error instanceof AppError &&
            (error.code === 'PAIRING_CODE_INVALID' || error.code === 'PAIRING_CODE_EXPIRED'),
          run: () =>
            createPairingService(app.db.device, app.tokenService).pairDevice({
              rawCode: code,
              deviceName: request.body?.deviceName?.trim() || 'Browser',
            }),
        },
      );
    },
  );
};
