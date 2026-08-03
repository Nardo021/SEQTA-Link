import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import { redactCalendarPath } from "../../shared/redact.js";

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/calendar/:token",
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const tokenParam = (request.params as { token: string }).token;
      const logPath = redactCalendarPath(request.url);

      let feed;
      try {
        const { rawToken } =
          app.tokenService.parseCalendarTokenFromPath(tokenParam);
        feed = app.feedService.authenticateCalendarToken(rawToken);
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 404) {
          request.log.info({ event: "calendar_not_found", route: logPath });
          return reply.status(404).send();
        }
        throw error;
      }

      const calendar = app.calendarService.getCalendar(feed);
      const ifNoneMatch = request.headers["if-none-match"];

      if (ifNoneMatch === calendar.etag) {
        request.log.info({
          event: "calendar_not_modified",
          feedId: feed.id,
          route: logPath,
        });
        reply.status(304);
        reply.header("ETag", calendar.etag);
        reply.header("Last-Modified", calendar.lastModified);
        reply.header("Cache-Control", "private, max-age=0, must-revalidate");
        return reply.send();
      }

      request.log.info({
        event: "calendar_served",
        feedId: feed.id,
        route: logPath,
        revision: calendar.revision,
      });

      reply.header("Content-Type", "text/calendar; charset=utf-8");
      reply.header(
        "Content-Disposition",
        'inline; filename="seqta-timetable.ics"',
      );
      reply.header("Cache-Control", "private, max-age=0, must-revalidate");
      reply.header("ETag", calendar.etag);
      reply.header("Last-Modified", calendar.lastModified);
      reply.header("X-Content-Type-Options", "nosniff");

      return calendar.body;
    },
  );
};
