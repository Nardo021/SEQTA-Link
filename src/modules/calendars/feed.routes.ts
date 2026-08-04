import type { FastifyPluginAsync } from 'fastify';
import { resolveCalendarTokenRecord } from '../../db/token-resolve.js';
import { AppError } from '../../shared/errors.js';
import { redactCalendarPath } from '../../shared/redact.js';
import { isNotFound, withBruteForce } from '../../security/with-brute-force.js';
import { EventRepository } from '../events/event.repository.js';
import { etagMatches } from './etag.js';
import { IcalFeedService } from './ical-feed.service.js';

const CALENDAR_CACHE_CONTROL = 'private, no-cache, max-age=0, must-revalidate';

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/calendar/:token',
    {
      config: {
        rateLimit: {
          max: 60,
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
        calendar = await withBruteForce(
          app.bruteForce,
          app.bruteForcePolicies.apiAuth,
          [{ scope: 'feed-ip', key: request.ip }],
          {
            shouldRecordFailure: isNotFound,
            run: async () => {
              const { rawToken } = app.tokenService.parseCalendarTokenFromPath(tokenParam);
              const hash = app.tokenService.hash('calendar', rawToken);
              return resolveCalendarTokenRecord(app.db.feed, hash);
            },
          },
        );
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

      const feed = await app.db.feed.withUserContext(calendar.ownerUserId, async (client) =>
        new IcalFeedService(app.config, new EventRepository(client)).getCalendar(calendar),
      );

      if (etagMatches(request.headers['if-none-match'], feed.etag)) {
        request.log.info({ event: 'calendar_not_modified', route: logPath });
        reply.status(304);
        reply.header('ETag', feed.etag);
        reply.header('Last-Modified', feed.lastModified);
        reply.header('Cache-Control', CALENDAR_CACHE_CONTROL);
        return reply.send();
      }

      request.log.info({
        event: 'calendar_served',
        route: logPath,
        revision: feed.revision,
      });

      reply.header('Content-Type', 'text/calendar; charset=utf-8');
      reply.header('Content-Disposition', 'inline; filename="seqta-timetable.ics"');
      reply.header('Cache-Control', CALENDAR_CACHE_CONTROL);
      reply.header('ETag', feed.etag);
      reply.header('Last-Modified', feed.lastModified);
      reply.header('X-Content-Type-Options', 'nosniff');

      return feed.body;
    },
  );
};
