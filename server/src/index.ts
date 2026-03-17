import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from 'fastify-rate-limit';
import { registerBackgroundJobRoutes } from './background-jobs-routes.js';
import { BackgroundJobRepository } from './background-jobs.js';
import { config } from './config.js';
import { registerCacheObservabilityRoutes } from './cache-observability.js';
import { createPool } from './db.js';
import { registerImageProxyRoute } from './image-cache.js';
import { registerHltbCachedRoute } from './hltb-cache.js';
import { registerMetacriticCachedRoute } from './metacritic-cache.js';
import { registerMobyGamesCachedRoute } from './mobygames-cache.js';
import { registerSteamPricesRoute } from './steam-prices.js';
import { registerPsPricesRoute } from './psprices-prices.js';
import { OpenAiEmbeddingClient } from './recommendations/embedding-client.js';
import { DiscoveryEnrichmentService } from './recommendations/discovery-enrichment-service.js';
import { DiscoveryIgdbClient } from './recommendations/discovery-igdb-client.js';
import { RecommendationRepository } from './recommendations/repository.js';
import { registerRecommendationRoutes } from './recommendations/routes.js';
import { RecommendationService } from './recommendations/service.js';
import { MetadataEnrichmentIgdbClient } from './metadata-enrichment/igdb-client.js';
import { ensureMiddieRegistered } from './middleware.js';
import { proxyMetadataToWorker } from './metadata.js';
import { registerManualRoutes } from './manuals.js';
import { registerNotificationRoutes } from './notifications.js';
import { registerPopularityRoutes } from './popularity/routes.js';
import { startReleaseMonitor } from './release-monitor.js';
import {
  CLIENT_WRITE_TOKEN_HEADER_NAME,
  isAuthorizedMutatingRequest,
  shouldRequireAuth
} from './request-security.js';
import { registerSyncRoutes } from './sync.js';

const serverRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  console.info('[api] starting', {
    pid: process.pid,
    host: config.host,
    port: config.port,
    nodeEnv: process.env.NODE_ENV ?? '',
    requireAuth: config.requireAuth,
    releaseMonitorEnabled: config.releaseMonitorEnabled,
    recommendationsSchedulerEnabled: config.recommendationsSchedulerEnabled,
    recommendationsDiscoveryEnabled: config.recommendationsDiscoveryEnabled,
    recommendationsDiscoveryEnrichEnabled: config.recommendationsDiscoveryEnrichEnabled,
    popularityIngestEnabled: config.popularityIngestEnabled
  });
  validateSecurityConfig();
  const pool = await createPool(config.postgresUrl);

  const imageCacheDir = await resolveWritableImageCacheDir(config.imageCacheDir);

  const app = Fastify({
    bodyLimit: config.requestBodyLimitBytes,
    logger: true
  });
  const requestStartedAtMs = new Map<string, number>();
  let closeHookRegistered = false;
  let releaseMonitor: ReturnType<typeof startReleaseMonitor> | null = null;
  const backgroundJobs = new BackgroundJobRepository(pool);
  const recommendationRepository = new RecommendationRepository(pool);
  const embeddingClient = new OpenAiEmbeddingClient({
    apiKey: config.openaiApiKey,
    model: config.recommendationsEmbeddingModel,
    dimensions: config.recommendationsEmbeddingDimensions,
    timeoutMs: config.recommendationsEmbeddingTimeoutMs
  });
  const discoveryIgdbClient = new DiscoveryIgdbClient({
    twitchClientId: config.twitchClientId,
    twitchClientSecret: config.twitchClientSecret,
    requestTimeoutMs: config.recommendationsDiscoveryIgdbRequestTimeoutMs,
    maxRequestsPerSecond: config.recommendationsDiscoveryIgdbMaxRequestsPerSecond
  });
  const metadataEnrichmentClient = new MetadataEnrichmentIgdbClient({
    twitchClientId: config.twitchClientId,
    twitchClientSecret: config.twitchClientSecret,
    requestTimeoutMs: config.igdbMetadataEnrichRequestTimeoutMs
  });
  const discoveryEnrichmentServiceOptions = {
    enabled: config.recommendationsDiscoveryEnrichEnabled,
    startupDelayMs: config.recommendationsDiscoveryEnrichStartupDelayMs,
    intervalMinutes: config.recommendationsDiscoveryEnrichIntervalMinutes,
    maxGamesPerRun: config.recommendationsDiscoveryEnrichMaxGamesPerRun,
    requestTimeoutMs: config.recommendationsDiscoveryEnrichRequestTimeoutMs,
    apiBaseUrl: `http://127.0.0.1:${String(config.port)}`,
    maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
    backoffBaseMinutes: config.recommendationsDiscoveryEnrichBackoffBaseMinutes,
    backoffMaxHours: config.recommendationsDiscoveryEnrichBackoffMaxHours,
    rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
    rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears
  };
  const discoveryEnrichmentService = new DiscoveryEnrichmentService(
    recommendationRepository,
    discoveryEnrichmentServiceOptions,
    () => Date.now(),
    metadataEnrichmentClient
  );
  const recommendationService = new RecommendationService(
    recommendationRepository,
    {
      topLimit: config.recommendationsTopLimit,
      laneLimit: config.recommendationsLaneLimit,
      similarityK: config.recommendationsSimilarityK,
      staleHours: config.recommendationsDailyStaleHours,
      failureBackoffMinutes: config.recommendationsFailureBackoffMinutes,
      semanticWeight: config.recommendationsSemanticWeight,
      similarityStructuredWeight: config.recommendationsSimilarityStructuredWeight,
      similaritySemanticWeight: config.recommendationsSimilaritySemanticWeight,
      embeddingModel: config.recommendationsEmbeddingModel,
      embeddingDimensions: config.recommendationsEmbeddingDimensions,
      embeddingBatchSize: config.recommendationsEmbeddingBatchSize,
      runtimeModeDefault: config.recommendationsRuntimeModeDefault,
      explorationWeight: config.recommendationsExplorationWeight,
      diversityPenaltyWeight: config.recommendationsDiversityPenaltyWeight,
      repeatPenaltyStep: config.recommendationsRepeatPenaltyStep,
      tuningMinRated: config.recommendationsTuningMinRated,
      keywordsStructuredMax: config.recommendationsKeywordsStructuredMax,
      keywordsEmbeddingMax: config.recommendationsKeywordsEmbeddingMax,
      keywordsGlobalMaxRatio: config.recommendationsKeywordsGlobalMaxRatio,
      keywordsStructuredMaxRatio: config.recommendationsKeywordsStructuredMaxRatio,
      keywordsMinLibraryCount: config.recommendationsKeywordsMinLibraryCount,
      keywordsWeight: config.recommendationsKeywordsWeight,
      themesWeight: config.recommendationsThemesWeight,
      similarityThemeWeight: config.recommendationsSimilarityThemeWeight,
      similarityGenreWeight: config.recommendationsSimilarityGenreWeight,
      similaritySeriesWeight: config.recommendationsSimilaritySeriesWeight,
      similarityDeveloperWeight: config.recommendationsSimilarityDeveloperWeight,
      similarityPublisherWeight: config.recommendationsSimilarityPublisherWeight,
      similarityKeywordWeight: config.recommendationsSimilarityKeywordWeight,
      discoveryEnabled: config.recommendationsDiscoveryEnabled,
      discoveryPoolSize: config.recommendationsDiscoveryPoolSize,
      discoveryRefreshHours: config.recommendationsDiscoveryRefreshHours,
      discoveryPopularRefreshHours: config.recommendationsDiscoveryPopularRefreshHours,
      discoveryRecentRefreshHours: config.recommendationsDiscoveryRecentRefreshHours,
      discoveryIgdbRequestTimeoutMs: config.recommendationsDiscoveryIgdbRequestTimeoutMs,
      discoveryIgdbMaxRequestsPerSecond: config.recommendationsDiscoveryIgdbMaxRequestsPerSecond
    },
    {
      embeddingClient,
      discoveryClient: discoveryIgdbClient,
      discoveryEnrichmentService
    }
  );

  try {
    // Register global rate limit FIRST
    await app.register(rateLimit, {
      global: true,
      max: config.globalRateLimitMaxRequests,
      timeWindow: `${String(Math.max(1, Math.floor(config.globalRateLimitWindowMs / 1000)))} seconds`
    });

    await app.register(cors, {
      origin: true,
      credentials: true
    });

    await ensureMiddieRegistered(app);
    app.addHook('onRequest', (request, _reply, done) => {
      requestStartedAtMs.set(request.id, Date.now());
      done();
    });
    app.addHook('onResponse', async (request, reply) => {
      const startedAt = requestStartedAtMs.get(request.id);
      const durationMs = startedAt ? Date.now() - startedAt : null;
      requestStartedAtMs.delete(request.id);
      console.info('[api] request_completed', {
        requestId: request.id,
        method: request.method,
        url: request.url,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
        durationMs
      });
    });

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
    registerNotificationRoutes(app, pool);
    await registerImageProxyRoute(app, pool, imageCacheDir);
    await registerCacheObservabilityRoutes(app, pool);
    registerBackgroundJobRoutes(app, pool);
    registerManualRoutes(app, {
      manualsDir: config.manualsDir,
      manualsPublicBaseUrl: config.manualsPublicBaseUrl,
      mode: 'queue',
      queuePool: pool,
      enqueueCatalogRefreshJob: (payload) => {
        void backgroundJobs.enqueue({
          jobType: 'manuals_catalog_refresh',
          dedupeKey: 'manuals-catalog-refresh',
          payload,
          priority: 110,
          maxAttempts: 3
        });
      }
    });

    releaseMonitor = startReleaseMonitor(pool);
    await registerHltbCachedRoute(app, pool, {
      enqueueRevalidationJob: (payload) => {
        void backgroundJobs.enqueue({
          jobType: 'hltb_cache_revalidate',
          dedupeKey: `hltb-cache-revalidate:${payload.cacheKey}`,
          payload,
          priority: 120,
          maxAttempts: 3
        });
      }
    });
    await registerMetacriticCachedRoute(app, pool, {
      enqueueRevalidationJob: (payload) => {
        void backgroundJobs.enqueue({
          jobType: 'metacritic_cache_revalidate',
          dedupeKey: `metacritic-cache-revalidate:${payload.cacheKey}`,
          payload,
          priority: 120,
          maxAttempts: 3
        });
      }
    });
    await registerMobyGamesCachedRoute(app, pool, {
      enableStaleWhileRevalidate: config.mobygamesCacheEnableStaleWhileRevalidate,
      freshTtlSeconds: config.mobygamesCacheFreshTtlSeconds,
      staleTtlSeconds: config.mobygamesCacheStaleTtlSeconds,
      enqueueRevalidationJob: (payload) => {
        void backgroundJobs.enqueue({
          jobType: 'mobygames_cache_revalidate',
          dedupeKey: `mobygames-cache-revalidate:${payload.cacheKey}`,
          payload,
          priority: 120,
          maxAttempts: 3
        });
      }
    });
    await registerSteamPricesRoute(app, pool, {
      enableStaleWhileRevalidate: config.steamPriceCacheEnableStaleWhileRevalidate,
      freshTtlSeconds: config.steamPriceCacheFreshTtlSeconds,
      staleTtlSeconds: config.steamPriceCacheStaleTtlSeconds,
      enqueueRevalidationJob: (payload) => {
        void backgroundJobs.enqueue({
          jobType: 'steam_price_revalidate',
          dedupeKey: `steam-price-revalidate:${payload.cacheKey}`,
          payload,
          priority: 120,
          maxAttempts: 3
        });
      }
    });
    await registerPsPricesRoute(app, pool, {
      enableStaleWhileRevalidate: config.pspricesPriceCacheEnableStaleWhileRevalidate,
      freshTtlSeconds: config.pspricesPriceCacheFreshTtlSeconds,
      staleTtlSeconds: config.pspricesPriceCacheStaleTtlSeconds,
      enqueueRevalidationJob: (payload) => {
        void backgroundJobs.enqueue({
          jobType: 'psprices_price_revalidate',
          dedupeKey: `psprices-price-revalidate:${payload.cacheKey}`,
          payload,
          priority: 120,
          maxAttempts: 3
        });
      }
    });
    await registerPopularityRoutes(app, pool, {
      rowLimit: config.popularityFeedRowLimit,
      threshold: config.popularityScoreThreshold
    });
    await registerRecommendationRoutes(app, recommendationService);

    app.setNotFoundHandler((request, reply) => {
      reply.code(404).send({
        error: 'Not found',
        path: request.url
      });
    });

    app.addHook('onClose', async () => {
      await releaseMonitor?.stop();
      await pool.end();
    });
    closeHookRegistered = true;

    await app.listen({
      host: config.host,
      port: config.port
    });
    console.info('[api] started', {
      pid: process.pid,
      host: config.host,
      port: config.port
    });

    let shuttingDown = false;
    const stop = async (signal: string): Promise<boolean> => {
      if (shuttingDown) {
        return true;
      }
      shuttingDown = true;
      console.info('[api] stopping', { signal });
      try {
        await app.close();
        console.info('[api] stopped', { signal });
        return true;
      } catch (error) {
        console.error('[api] stop_failed', {
          signal,
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
    };

    const handleSignal = async (signal: 'SIGINT' | 'SIGTERM'): Promise<void> => {
      const cleanShutdown = await stop(signal);
      process.exitCode = cleanShutdown ? 0 : 1;
      process.exit();
    };

    process.on('SIGINT', () => {
      void handleSignal('SIGINT');
    });
    process.on('SIGTERM', () => {
      void handleSignal('SIGTERM');
    });

    if (config.recommendationsSchedulerEnabled) {
      console.info(
        '[recommendations] RECOMMENDATIONS_SCHEDULER_ENABLED is set on API process; scheduler execution is handled by background-worker'
      );
    }
  } catch (error) {
    console.error('[api] startup_failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    if (closeHookRegistered) {
      await app.close().catch(() => undefined);
    } else {
      if (releaseMonitor) {
        await releaseMonitor.stop().catch(() => undefined);
      }
      await pool.end().catch(() => undefined);
    }
    throw error;
  }
}

function validateSecurityConfig(): void {
  if (config.requireAuth && config.apiToken.length === 0 && config.clientWriteTokens.length === 0) {
    throw new Error(
      'REQUIRE_AUTH is enabled but no auth credentials are configured. Configure an API token via API_TOKEN_FILE or /run/secrets/api_token, or client write tokens via CLIENT_WRITE_TOKENS_FILE or /run/secrets/client_write_tokens.'
    );
  }
}

main().catch((error: unknown) => {
  console.error('[api] fatal', error);
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
