import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { EventRepository } from "../modules/events/event.repository.js";
import { CalendarService } from "../modules/calendar/calendar.service.js";
import { FeedRepository } from "../modules/feeds/feed.repository.js";
import { FeedService } from "../modules/feeds/feed.service.js";
import {
  createTokenService,
  type TokenService,
} from "../modules/feeds/token.service.js";
import { SyncRepository } from "../modules/sync/sync.repository.js";
import { SyncService } from "../modules/sync/sync.service.js";

declare module "fastify" {
  interface FastifyInstance {
    tokenService: TokenService;
    feedService: FeedService;
    syncService: SyncService;
    calendarService: CalendarService;
  }
}

const servicesPlugin: FastifyPluginAsync = async (app) => {
  const eventRepository = new EventRepository(app.db);
  const feedRepository = new FeedRepository(app.db);
  const syncRepository = new SyncRepository(app.db);
  const tokenService = createTokenService(app.config);
  const feedService = new FeedService(app.config, tokenService, feedRepository);
  const syncService = new SyncService(app.db, app.config, {
    syncRepo: syncRepository,
    eventRepo: eventRepository,
    feedRepo: feedRepository,
  });
  const calendarService = new CalendarService(app.config, eventRepository);

  app.decorate("tokenService", tokenService);
  app.decorate("feedService", feedService);
  app.decorate("syncService", syncService);
  app.decorate("calendarService", calendarService);
};

export default fp(servicesPlugin, {
  name: "services",
  dependencies: ["database"],
});
