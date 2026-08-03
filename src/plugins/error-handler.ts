import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../shared/errors.js';

export function registerErrorHandler(app: {
  setErrorHandler: (
    handler: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) => void,
  ) => void;
  config: { nodeEnv: string };
}): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.requestId;

    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: error.message,
          requestId,
        },
      });
      return;
    }

    if (error.statusCode === 413) {
      reply.status(413).send({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large.',
          requestId,
        },
      });
      return;
    }

    request.log.error({ err: error, requestId, event: 'request_failed' });

    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId,
      },
    });
  });
}
