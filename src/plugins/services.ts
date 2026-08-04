import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createTokenService, type TokenService } from '../security/token.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    tokenService: TokenService;
  }
}

const servicesPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('tokenService', createTokenService(app.config));
};

export default fp(servicesPlugin, { name: 'services', dependencies: ['database'] });
