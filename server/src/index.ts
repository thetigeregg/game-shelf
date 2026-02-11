import fs from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { createPool } from './db.js';
import { registerImageProxyRoute } from './image-cache.js';
import { proxyMetadataToWorker } from './metadata.js';
import { registerSyncRoutes } from './sync.js';

async function main(): Promise<void> {
  const pool = await createPool(config.postgresUrl);
  await fs.mkdir(config.imageCacheDir, { recursive: true });

  const app = Fastify({
    logger: true,
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
  registerImageProxyRoute(app, pool, config.imageCacheDir);

  app.get('/v1/games/search', proxyMetadataToWorker);
  app.get('/v1/games/:id', proxyMetadataToWorker);
  app.get('/v1/platforms', proxyMetadataToWorker);
  app.get('/v1/images/boxart/search', proxyMetadataToWorker);
  app.get('/v1/hltb/search', proxyMetadataToWorker);

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

main().catch(error => {
  console.error('[server] startup_failed', error);
  process.exitCode = 1;
});

