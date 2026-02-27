import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from 'fastify-rate-limit';
import { config } from './config.js';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import { createPool } from './db.js';
import { registerImageProxyRoute } from './image-cache.js';
import { registerHltbCachedRoute } from './hltb-cache.js';
import { registerMetacriticCachedRoute } from './metacritic-cache.js';
import { ensureMiddieRegistered } from './middleware.js';
import { proxyMetadataToWorker } from './metadata.js';
import { registerManualRoutes } from './manuals.js';
import {
  CLIENT_WRITE_TOKEN_HEADER_NAME,
  isAuthorizedMutatingRequest,
  shouldRequireAuth
} from './request-security.js';
import { registerSyncRoutes } from './sync.js';

const serverRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  validateSecurityConfig();
  const pool = await createPool(config.postgresUrl);

  const imageCacheDir = await resolveWritableImageCacheDir(config.imageCacheDir);

  const app = Fastify({
    bodyLimit: config.requestBodyLimitBytes,
    logger: true
  });

  // Register global rate limit FIRST
  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: '15 minutes'
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await ensureMiddieRegistered(app);

  app.use((request: IncomingMessage, response: ServerResponse, next) => {
    if (!shouldRequireAuth(request.method ?? '')) {
      next();
      return;
    }

    if (
      !isAuthorizedMutatingRequest({
        requireAuth: config.requireAuth,
        apiToken: config.apiToken,
        clientWriteTokens: config.clientWriteTokens,
        authorizationHeader: request.headers.authorization,
        clientWriteTokenHeader: request.headers[CLIENT_WRITE_TOKEN_HEADER_NAME]
      })
    ) {
      response.statusCode = 401;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    next();
  });

  // Health endpoint
  app.route({
    method: 'GET',
    url: '/v1/health',
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    handler: async (request, reply) => {
      try {
        await pool.query('SELECT 1');
        reply.send({ ok: true });
      } catch {
        reply.code(503).send({ ok: false });
      }
    }
  });

  // Metadata proxy routes — FIXED FOR CODEQL
  app.route({
    method: 'GET',
    url: '/v1/games/search',
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    handler: proxyMetadataToWorker
  });

  app.route({
    method: 'GET',
    url: '/v1/games/:id',
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    handler: proxyMetadataToWorker
  });

  app.route({
    method: 'GET',
    url: '/v1/platforms',
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    handler: proxyMetadataToWorker
  });

  app.route({
    method: 'GET',
    url: '/v1/popularity/types',
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    handler: proxyMetadataToWorker
  });

  app.route({
    method: 'GET',
    url: '/v1/popularity/primitives',
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    handler: proxyMetadataToWorker
  });

  app.route({
    method: 'GET',
    url: '/v1/images/boxart/search',
    config: {
      rateLimit: {
        max: 50,
        timeWindow: '1 minute'
      }
    },
    handler: proxyMetadataToWorker
  });

  // Register modular routes AFTER rateLimit
  await registerSyncRoutes(app, pool);
  await registerImageProxyRoute(app, pool, imageCacheDir);
  await registerCacheObservabilityRoutes(app, pool);
  registerManualRoutes(app, {
    manualsDir: config.manualsDir,
    manualsPublicBaseUrl: config.manualsPublicBaseUrl
  });
  await registerHltbCachedRoute(app, pool);
  await registerMetacriticCachedRoute(app, pool);

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: 'Not found' });
  });

  await app.listen({
    host: config.host,
    port: config.port
  });
}

function validateSecurityConfig(): void {
  if (config.requireAuth && config.apiToken.length === 0 && config.clientWriteTokens.length === 0) {
    throw new Error(
      'REQUIRE_AUTH is enabled but no auth credentials are configured. Configure an API token via API_TOKEN_FILE or /run/secrets/api_token, or client write tokens via CLIENT_WRITE_TOKENS_FILE or /run/secrets/client_write_tokens.'
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function resolveWritableImageCacheDir(preferredDir: string): Promise<string> {
  try {
    await fs.mkdir(preferredDir, { recursive: true });
    return preferredDir;
  } catch {
    const fallback = path.resolve(serverRootDir, '.data/images');
    await fs.mkdir(fallback, { recursive: true });
    return fallback;
  }
}
