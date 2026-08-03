import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const securityHeadersPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
};

export default fp(securityHeadersPlugin, { name: 'security-headers' });
