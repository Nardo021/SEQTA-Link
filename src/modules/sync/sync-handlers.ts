import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../shared/errors.js';
import { syncBodySchema, type SyncRequestBody } from './sync.schemas.js';
import { createScopedServices } from '../../services/scoped-services.js';

type SyncPreHandler = (request: FastifyRequest) => Promise<void>;

interface SyncRouteOptions {
  statusPath: string;
  syncPath: string;
  preHandler: SyncPreHandler;
  rateLimitKey: (request: FastifyRequest) => string;
  logSyncEvents?: boolean;
}

export function registerSyncEndpoints(app: FastifyInstance, options: SyncRouteOptions): void {
  app.get(
    options.statusPath,
    {
      preHandler: options.preHandler,
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: options.rateLimitKey,
        },
      },
    },
    async (request) => {
      const context = request.syncContext!;
      return app.db.device.withUserContext(context.ownerUserId, async (client) => {
        const { calendar } = createScopedServices(client, app.config, app.tokenService);
        return calendar.getStatus(context);
      });
    },
  );

  app.post<{ Body: SyncRequestBody }>(
    options.syncPath,
    {
      preHandler: options.preHandler,
      schema: { body: syncBodySchema },
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '10 minutes',
          keyGenerator: options.rateLimitKey,
        },
      },
    },
    async (request) => {
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string') {
        throw new AppError('INVALID_REQUEST', 'Idempotency-Key header is required.', 400);
      }

      const context = request.syncContext!;
      if (options.logSyncEvents) {
        request.log.info({
          event: 'sync_started',
          calendarId: context.calendar.id,
          requestId: request.requestId,
        });
      }

      const result = await app.db.device.withUserContext(context.ownerUserId, async (client) => {
        const { sync } = createScopedServices(client, app.config, app.tokenService);
        return sync.sync(context, idempotencyKey, request.body);
      });

      if (options.logSyncEvents) {
        request.log.info({
          event: 'sync_completed',
          calendarId: context.calendar.id,
          requestId: request.requestId,
          changed: result.changed,
          received: result.result.received,
        });
      }

      return result;
    },
  );
}
