import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { IcalFeedService } from '../modules/calendar/ical-feed.service.js';
import { EventRepository } from '../modules/events/event.repository.js';
import { createTokenService, type TokenService } from '../modules/feeds/token.service.js';
import {
  createCalendarService,
  createSyncService,
} from '../services/scoped-services.js';

declare module 'fastify' {
  interface FastifyInstance {
    tokenService: TokenService;
    calendarService: ReturnType<typeof createCalendarService>;
    icalFeedService: IcalFeedService;
    syncService: ReturnType<typeof createSyncService>;
  }
}

const servicesPlugin: FastifyPluginAsync = async (app) => {
  const tokenService = createTokenService(app.config);
  const calendarService = createCalendarService(app.db.device, app.config, tokenService);
  const syncService = createSyncService(app.db.device, app.config);
  const icalFeedService = new IcalFeedService(app.config, new EventRepository(app.db.feed));

  app.decorate('tokenService', tokenService);
  app.decorate('calendarService', calendarService);
  app.decorate('icalFeedService', icalFeedService);
  app.decorate('syncService', syncService);
};

export default fp(servicesPlugin, { name: 'services', dependencies: ['database'] });
