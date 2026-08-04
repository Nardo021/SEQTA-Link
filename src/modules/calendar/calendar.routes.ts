import type { FastifyPluginAsync } from 'fastify';
import { EventRepository } from '../events/event.repository.js';
import { IcalFeedService } from './ical-feed.service.js';
import { AppError } from '../../shared/errors.js';
import { redactCalendarPath } from '../../shared/redact.js';

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/calendar/:token',
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute',
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const tokenParam = (request.params as { token: string }).token;
      const logPath = redactCalendarPath(request.url);

      let calendar;
      try {
        const { rawToken } = app.tokenService.parseCalendarTokenFromPath(tokenParam);
        calendar = await app.calendarService.authenticateCalendarToken(rawToken);
      } catch (error) {
        if (error instanceof AppError && (error.statusCode === 404 || error.code === 'FEED_DISABLED')) {
          request.log.info({ event: 'calendar_not_found', route: logPath, code: error.code });
          reply.status(error.statusCode === 410 ? 410 : 404);
          if (error.statusCode === 410) {
            return reply.send(error.message);
          }
          return reply.send();
        }
        throw error;
      }

      const feed = await app.db.feed.withUserContext(calendar.ownerUserId, async (client) => {
        const icalFeedService = new IcalFeedService(app.config, new EventRepository(client));
        return icalFeedService.getCalendar(calendar);
      });

      const ifNoneMatch = request.headers['if-none-match'];

      if (ifNoneMatch === feed.etag) {
        request.log.info({ event: 'calendar_not_modified', route: logPath });
        reply.status(304);
        reply.header('ETag', feed.etag);
        reply.header('Last-Modified', feed.lastModified);
        reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
        return reply.send();
      }

      request.log.info({
        event: 'calendar_served',
        route: logPath,
        revision: feed.revision,
      });

      reply.header('Content-Type', 'text/calendar; charset=utf-8');
      reply.header('Content-Disposition', 'inline; filename="seqta-timetable.ics"');
      reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
      reply.header('ETag', feed.etag);
      reply.header('Last-Modified', feed.lastModified);
      reply.header('X-Content-Type-Options', 'nosniff');

      return feed.body;
    },
  );
};
