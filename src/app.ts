import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import servicesPlugin from './plugins/services.js';
import authenticationPlugin from './plugins/authentication.js';
import requestContextPlugin from './plugins/request-context.js';
import securityHeadersPlugin from './plugins/security-headers.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { syncRoutes } from './modules/sync/sync.routes.js';
import { calendarRoutes } from './modules/calendar/calendar.routes.js';
import { redactAuthorizationHeader } from './shared/redact.js';

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url.replace(/\/calendar\/[^/?]+\.ics/i, '/calendar/[REDACTED].ics'),
            headers: redactAuthorizationHeader(request.headers as Record<string, unknown>),
          };
        },
      },
    },
    trustProxy: config.trustProxy,
    bodyLimit: config.maxBodyBytes,
  });

  app.decorate('config', config);

  registerErrorHandler(app);

  await app.register(requestContextPlugin);
  await app.register(securityHeadersPlugin);
  await app.register(databasePlugin);
  await app.register(servicesPlugin);
  await app.register(authenticationPlugin);

  await app.register(cors, {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
  });

  await app.register(rateLimit, {
    global: false,
  });

  await app.register(healthRoutes);
  await app.register(syncRoutes);
  await app.register(calendarRoutes);

  return app;
}
