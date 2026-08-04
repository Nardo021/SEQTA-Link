import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { BruteForceGuard, type BruteForcePolicy } from '../security/brute-force-guard.js';

export interface BruteForcePolicies {
  login: BruteForcePolicy;
  register: BruteForcePolicy;
  apiAuth: BruteForcePolicy;
}

const bruteForcePlugin: FastifyPluginAsync = async (app) => {
  const guard = new BruteForceGuard();
  const policies: BruteForcePolicies = {
    login: {
      maxFailures: app.config.authLoginMaxFailures,
      windowMs: app.config.authLoginWindowMinutes * 60_000,
      lockoutMs: app.config.authLoginLockoutMinutes * 60_000,
    },
    register: {
      maxFailures: app.config.authRegisterMaxFailures,
      windowMs: app.config.authRegisterWindowMinutes * 60_000,
      lockoutMs: app.config.authRegisterLockoutMinutes * 60_000,
    },
    apiAuth: {
      maxFailures: app.config.apiAuthMaxFailures,
      windowMs: app.config.apiAuthWindowMinutes * 60_000,
      lockoutMs: app.config.apiAuthLockoutMinutes * 60_000,
    },
  };

  app.decorate('bruteForce', guard);
  app.decorate('bruteForcePolicies', policies);
};

declare module 'fastify' {
  interface FastifyInstance {
    bruteForce: BruteForceGuard;
    bruteForcePolicies: BruteForcePolicies;
  }
}

export default fp(bruteForcePlugin, { name: 'brute-force' });
