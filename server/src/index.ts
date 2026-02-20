import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import { createPool } from './db.js';
import { registerImageProxyRoute } from './image-cache.js';
import { registerHltbCachedRoute } from './hltb-cache.js';
import { proxyMetadataToWorker } from './metadata.js';
import { registerManualRoutes } from './manuals.js';
import { registerSyncRoutes } from './sync.js';
const serverRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const pool = await createPool(config.postgresUrl);
  const imageCacheDir = await resolveWritableImageCacheDir(config.imageCacheDir);
  validateSecurityConfig();
  console.info('[server] image_cache_dir_ready', {
    configured: config.imageCacheDir,
    active: imageCacheDir
  });

  const app = Fastify({
    bodyLimit: config.requestBodyLimitBytes,
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      }
    }
  });

  app.log.info({
    event: 'server_timezone_configured',
    tzEnv: process.env.TZ ?? 'unset',
    runtimeTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowed = isCorsOriginAllowed(origin);
      callback(null, allowed);
    },
    credentials: true
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!isProtectedRoute(request)) {
      return;
    }

    if (!isAuthorizedRequest(request)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/v1/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      reply.send({
        ok: true,
        service: 'game-shelf-server',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      reply.code(503).send({
        ok: false,
        error: 'Database unavailable'
      });
    }
  });

  registerSyncRoutes(app, pool);
  registerImageProxyRoute(app, pool, imageCacheDir, {
    timeoutMs: config.imageProxyTimeoutMs,
    maxBytes: config.imageProxyMaxBytes,
    rateLimitWindowMs: config.imageProxyRateLimitWindowMs,
    imageProxyMaxRequestsPerWindow: config.imageProxyMaxRequestsPerWindow,
    imagePurgeMaxRequestsPerWindow: config.imagePurgeMaxRequestsPerWindow
  });
  registerCacheObservabilityRoutes(app, pool);
  registerManualRoutes(app, {
    manualsDir: config.manualsDir,
    manualsPublicBaseUrl: config.manualsPublicBaseUrl
  });

  app.get('/v1/games/search', proxyMetadataToWorker);
  app.get('/v1/games/:id', proxyMetadataToWorker);
  app.get('/v1/platforms', proxyMetadataToWorker);
  app.get('/v1/popularity/types', proxyMetadataToWorker);
  app.get('/v1/popularity/primitives', proxyMetadataToWorker);
  app.get('/v1/images/boxart/search', proxyMetadataToWorker);
  registerHltbCachedRoute(app, pool, {
    enableStaleWhileRevalidate: config.hltbCacheEnableStaleWhileRevalidate,
    freshTtlSeconds: config.hltbCacheFreshTtlSeconds,
    staleTtlSeconds: config.hltbCacheStaleTtlSeconds
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Not found',
      path: request.url
    });
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.listen({
    host: config.host,
    port: config.port
  });
}

function validateSecurityConfig(): void {
  if (config.requireAuth && config.apiToken.length === 0) {
    throw new Error('REQUIRE_AUTH is enabled but API_TOKEN is not configured.');
  }
}

function isCorsOriginAllowed(origin: string): boolean {
  return config.corsAllowedOrigins.some((allowedOrigin) => allowedOrigin === origin);
}

function isProtectedRoute(request: FastifyRequest): boolean {
  if (request.method !== 'POST') {
    return false;
  }

  return (
    request.url === '/v1/sync/push' ||
    request.url === '/v1/sync/pull' ||
    request.url === '/v1/images/cache/purge' ||
    request.url === '/v1/manuals/refresh'
  );
}

function isAuthorizedRequest(request: FastifyRequest): boolean {
  if (!config.requireAuth) {
    return true;
  }

  const authorization = String(request.headers.authorization ?? '').trim();

  if (!authorization.startsWith('Bearer ')) {
    return false;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 && token === config.apiToken;
}

main().catch((error) => {
  console.error('[server] startup_failed', error);
  process.exitCode = 1;
});

async function resolveWritableImageCacheDir(preferredDir: string): Promise<string> {
  try {
    await fs.mkdir(preferredDir, { recursive: true });
    return preferredDir;
  } catch (error) {
    const fallback = path.resolve(serverRootDir, '.data/images');
    await fs.mkdir(fallback, { recursive: true });
    console.warn('[server] image_cache_dir_fallback', {
      preferredDir,
      fallback,
      reason: error instanceof Error ? error.message : String(error)
    });
    return fallback;
  }
}
