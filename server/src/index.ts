import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import { createPool } from './db.js';
import { registerImageProxyRoute } from './image-cache.js';
import { registerHltbCachedRoute } from './hltb-cache.js';
import { proxyMetadataToWorker } from './metadata.js';
import { registerManualRoutes } from './manuals.js';
import { registerSyncRoutes } from './sync.js';
const serverRootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function main(): Promise<void> {
  const pool = await createPool(config.postgresUrl);
  const imageCacheDir = await resolveWritableImageCacheDir(
    config.imageCacheDir,
  );
  console.info('[server] image_cache_dir_ready', {
    configured: config.imageCacheDir,
    active: imageCacheDir,
  });

  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    },
  });

  await app.register(cors, {
    origin: config.corsOrigin === '*' ? true : config.corsOrigin,
    credentials: true,
  });

  app.get('/v1/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      reply.send({
        ok: true,
        service: 'game-shelf-server',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      reply.code(503).send({
        ok: false,
        error: 'Database unavailable',
      });
    }
  });

  registerSyncRoutes(app, pool);
  registerImageProxyRoute(app, pool, imageCacheDir);
  registerCacheObservabilityRoutes(app, pool);
  registerManualRoutes(app, {
    manualsDir: config.manualsDir,
    manualsPublicBaseUrl: config.manualsPublicBaseUrl,
  });

  app.get('/v1/games/search', proxyMetadataToWorker);
  app.get('/v1/games/:id', proxyMetadataToWorker);
  app.get('/v1/platforms', proxyMetadataToWorker);
  app.get('/v1/images/boxart/search', proxyMetadataToWorker);
  registerHltbCachedRoute(app, pool, {
    enableStaleWhileRevalidate: config.hltbCacheEnableStaleWhileRevalidate,
    freshTtlSeconds: config.hltbCacheFreshTtlSeconds,
    staleTtlSeconds: config.hltbCacheStaleTtlSeconds,
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Not found',
      path: request.url,
    });
  });

  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.listen({
    host: config.host,
    port: config.port,
  });
}

main().catch((error) => {
  console.error('[server] startup_failed', error);
  process.exitCode = 1;
});

async function resolveWritableImageCacheDir(
  preferredDir: string,
): Promise<string> {
  try {
    await fs.mkdir(preferredDir, { recursive: true });
    return preferredDir;
  } catch (error) {
    const fallback = path.resolve(serverRootDir, '.data/images');
    await fs.mkdir(fallback, { recursive: true });
    console.warn('[server] image_cache_dir_fallback', {
      preferredDir,
      fallback,
      reason: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}
