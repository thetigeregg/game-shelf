import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { rateLimit as expressRateLimit } from 'express-rate-limit';
import { config } from './config.js';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import { createPool } from './db.js';
import { registerImageProxyRoute } from './image-cache.js';
import { registerHltbCachedRoute } from './hltb-cache.js';
import { ensureMiddieRegistered } from './middleware.js';
import { proxyMetadataToWorker } from './metadata.js';
import { registerManualRoutes } from './manuals.js';
import { shouldRequireAuth } from './request-security.js';
import { registerSyncRoutes } from './sync.js';
const serverRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEALTH_RATE_LIMIT_WINDOW_MS = 60_000;
const HEALTH_MAX_REQUESTS_PER_WINDOW = 1000;
const healthRateLimitState = new Map<string, { windowStart: number; count: number }>();

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

  await ensureMiddieRegistered(app);
  app.use(
    expressRateLimit({
      windowMs: 60_000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (request) => String(request.socket?.remoteAddress ?? 'unknown')
    })
  );

  app.use((request: IncomingMessage, response: ServerResponse, next) => {
    if (!shouldRequireAuth(request.method ?? '')) {
      next();
      return;
    }

    if (!isAuthorizedRequestHeader(request.headers.authorization)) {
      response.statusCode = 401;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    next();
  });

  app.get('/v1/health', async (request, reply) => {
    if (isHealthRateLimitExceeded(Date.now(), resolveHealthRateLimitKey(request.ip))) {
      reply.header(
        'Retry-After',
        String(Math.max(1, Math.ceil(HEALTH_RATE_LIMIT_WINDOW_MS / 1000)))
      );
      reply.code(429).send({ error: 'Too many requests.' });
      return;
    }

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

  await registerSyncRoutes(app, pool);
  await registerImageProxyRoute(app, pool, imageCacheDir, {
    timeoutMs: config.imageProxyTimeoutMs,
    maxBytes: config.imageProxyMaxBytes,
    rateLimitWindowMs: config.imageProxyRateLimitWindowMs,
    imageProxyMaxRequestsPerWindow: config.imageProxyMaxRequestsPerWindow,
    imagePurgeMaxRequestsPerWindow: config.imagePurgeMaxRequestsPerWindow
  });
  await registerCacheObservabilityRoutes(app, pool, {
    cacheStatsRateLimitWindowMs: config.cacheStatsRateLimitWindowMs,
    cacheStatsMaxRequestsPerWindow: config.cacheStatsMaxRequestsPerWindow
  });
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
  await registerHltbCachedRoute(app, pool, {
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

function isAuthorizedRequestHeader(authorizationHeader: string | string[] | undefined): boolean {
  if (!config.requireAuth) {
    return true;
  }

  const authorizationRaw = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;
  const authorization = String(authorizationRaw ?? '').trim();

  if (!authorization.startsWith('Bearer ')) {
    return false;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 && token === config.apiToken;
}

function resolveHealthRateLimitKey(ip: string | undefined): string {
  const normalized = String(ip ?? '').trim();
  return normalized.length > 0 ? normalized : 'unknown';
}

function isHealthRateLimitExceeded(nowMs: number, key: string): boolean {
  const existing = healthRateLimitState.get(key);

  if (!existing || nowMs - existing.windowStart >= HEALTH_RATE_LIMIT_WINDOW_MS) {
    healthRateLimitState.set(key, {
      windowStart: nowMs,
      count: 1
    });
    return false;
  }

  const updatedCount = existing.count + 1;
  healthRateLimitState.set(key, {
    windowStart: existing.windowStart,
    count: updatedCount
  });
  return updatedCount > HEALTH_MAX_REQUESTS_PER_WINDOW;
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
