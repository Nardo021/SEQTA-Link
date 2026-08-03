import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    request.requestId = (request.headers['x-request-id'] as string | undefined) ?? randomUUID();
  });

  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      event: 'request_completed',
      requestId: request.requestId,
      route: request.routeOptions.url ?? request.url,
      feedId: request.feed?.id,
      statusCode: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
  });
};

export default fp(requestContextPlugin, { name: 'request-context' });
