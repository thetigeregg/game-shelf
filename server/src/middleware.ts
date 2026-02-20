import type { FastifyInstance } from 'fastify';
import middie from '@fastify/middie';

export async function ensureMiddieRegistered(app: FastifyInstance): Promise<void> {
  if (!app.hasDecorator('use')) {
    await app.register(middie);
  }
}

export function makeExpressRateLimitHandler(
  retryAfterSeconds: number
): (
  _req: unknown,
  res: {
    statusCode: number;
    setHeader: (name: string, value: string) => void;
    end: (body: string) => void;
  }
) => void {
  return (_req, res): void => {
    res.statusCode = 429;
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Too many requests.' }));
  };
}
