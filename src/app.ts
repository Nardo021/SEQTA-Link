import Fastify from 'fastify';
import fp from 'fastify-plugin';
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
import { authRoutes } from './modules/auth/auth.routes.js';
import { deviceRoutes } from './modules/devices/device.routes.js';
import { meRoutes } from './modules/me/me.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { invitationRoutes } from './modules/invitations/invitation.routes.js';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactAuthorizationHeader } from './shared/redact.js';
import type { AppDatabase } from './db/client.js';

export interface BuildAppOptions {
  db?: AppDatabase;
}

export async function buildApp(config: AppConfig, options: BuildAppOptions = {}) {
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
  if (options.db) {
    app.decorate('db', options.db);
    await app.register(
      fp(async () => {}, { name: 'database' }),
    );
  } else {
    await app.register(databasePlugin);
  }
  await app.register(servicesPlugin);
  await app.register(authenticationPlugin);

  await app.register(cookie);

  await app.register(cors, {
    origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    credentials: true,
  });

  await app.register(rateLimit, {
    global: false,
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(syncRoutes);
  await app.register(deviceRoutes);
  await app.register(meRoutes);
  await app.register(adminRoutes);
  await app.register(invitationRoutes);
  await app.register(calendarRoutes);

  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../web');
  await app.register(fastifyStatic, {
    root: webRoot,
    prefix: '/',
    decorateReply: false,
  });

  app.get('/app', async (_request, reply) => reply.redirect('/app/dashboard.html'));
  app.get('/app/', async (_request, reply) => reply.redirect('/app/dashboard.html'));
  app.get('/admin', async (_request, reply) => reply.redirect('/admin/dashboard.html'));
  app.get('/admin/', async (_request, reply) => reply.redirect('/admin/dashboard.html'));

  return app;
}
