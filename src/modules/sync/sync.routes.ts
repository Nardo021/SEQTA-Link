import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { syncBodySchema, type SyncRequestBody } from './sync.schemas.js';

export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/status',
    {
      preHandler: app.authenticateUpload,
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.feed?.id ?? request.ip,
        },
      },
    },
    async (request) => {
      return app.feedService.getStatus(request.feed!);
    },
  );

  app.post<{ Body: SyncRequestBody }>(
    '/api/v1/sync',
    {
      preHandler: app.authenticateUpload,
      schema: {
        body: syncBodySchema,
      },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '10 minutes',
          keyGenerator: (request) => request.feed?.id ?? request.ip,
        },
      },
    },
    async (request) => {
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        throw new AppError('INVALID_REQUEST', 'Idempotency-Key header is required.', 400);
      }

      request.log.info({
        event: 'sync_started',
        feedId: request.feed!.id,
        requestId: request.requestId,
      });

      const result = await app.syncService.sync(request.feed!, idempotencyKey, request.body);

      request.log.info({
        event: 'sync_completed',
        feedId: request.feed!.id,
        requestId: request.requestId,
        changed: result.changed,
        received: result.result.received,
      });

      return result;
    },
  );
};
