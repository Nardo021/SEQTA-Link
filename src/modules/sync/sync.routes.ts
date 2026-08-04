import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { CalendarReadService } from '../calendars/calendar-read.service.js';
import { SyncService } from './sync.service.js';
import { createSyncServiceDeps } from '../../services/service-factories.js';
import { syncBodySchema, type SyncRequestBody } from './sync.schemas.js';

export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/v1/status',
    {
      preHandler: app.authenticateSyncToken,
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.syncContext?.calendar.id ?? request.ip,
        },
      },
    },
    async (request) => {
      const context = request.syncContext!;
      return app.db.device.withUserContext(context.ownerUserId, async (client) =>
        new CalendarReadService(client).getStatus(context),
      );
    },
  );

  app.post<{ Body: SyncRequestBody }>(
    '/api/v1/sync',
    {
      preHandler: app.authenticateSyncToken,
      schema: { body: syncBodySchema },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '10 minutes',
          keyGenerator: (request) => request.syncContext?.calendar.id ?? request.ip,
        },
      },
    },
    async (request) => {
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        throw new AppError('INVALID_REQUEST', 'Idempotency-Key header is required.', 400);
      }

      const context = request.syncContext!;
      request.log.info({
        event: 'sync_started',
        calendarId: context.calendar.id,
        requestId: request.requestId,
      });

      const result = await app.db.device.withUserContext(context.ownerUserId, async (client) => {
        const sync = new SyncService(client, app.config, createSyncServiceDeps(client));
        return sync.sync(context, idempotencyKey, request.body);
      });

      request.log.info({
        event: 'sync_completed',
        calendarId: context.calendar.id,
        requestId: request.requestId,
        changed: result.changed,
        received: result.result.received,
      });

      return result;
    },
  );
};
