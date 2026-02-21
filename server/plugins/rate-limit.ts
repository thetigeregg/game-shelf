// server/plugins/rate-limit.ts
// Centralized Fastify rate limit plugin compatible with CodeQL detection

import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';

export default fp(async function rateLimitPlugin(fastify: FastifyInstance) {
  // Global baseline limit (applies to all routes)
  await fastify.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '15 minutes',
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true
    }
  });
});

// Explicit per-route config helper (CodeQL-friendly)
export const DEFAULT_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 50,
      timeWindow: '1 minute'
    }
  }
};

// Stricter limit for sensitive routes
export const STRICT_RATE_LIMIT = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute'
    }
  }
};
