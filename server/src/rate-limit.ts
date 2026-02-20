import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';

export async function ensureRouteRateLimitRegistered(app: FastifyInstance): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, {
      global: false
    });
  }
}
