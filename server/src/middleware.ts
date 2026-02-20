import type { FastifyInstance } from 'fastify';
import middie from '@fastify/middie';

export async function ensureMiddieRegistered(app: FastifyInstance): Promise<void> {
  if (!app.hasDecorator('use')) {
    await app.register(middie);
  }
}
