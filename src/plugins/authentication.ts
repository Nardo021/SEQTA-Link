import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

const authenticationPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('feed', undefined);
  app.decorateRequest('rawToken', undefined);
  app.decorateRequest('tokenType', undefined);

  app.decorate(
    'authenticateUpload',
    async (request: FastifyRequest): Promise<void> => {
      const { rawToken } = app.tokenService.parseBearerToken(request.headers.authorization);
      const feed = app.feedService.authenticateUploadToken(rawToken);

      request.rawToken = rawToken;
      request.tokenType = 'upload';
      request.feed = feed;
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    authenticateUpload: (request: FastifyRequest) => Promise<void>;
  }
}

export default fp(authenticationPlugin, {
  name: 'authentication',
  dependencies: ['services'],
});
