import {
  BackgroundJobRepository,
  BackgroundJobType,
  ClaimedBackgroundJob
} from './background-jobs.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { MetadataEnrichmentIgdbClient } from './metadata-enrichment/igdb-client.js';
import { MetadataEnrichmentRepository } from './metadata-enrichment/repository.js';
import { MetadataEnrichmentService } from './metadata-enrichment/service.js';
import { OpenAiEmbeddingClient } from './recommendations/embedding-client.js';
import { DiscoveryEnrichmentService } from './recommendations/discovery-enrichment-service.js';
import { DiscoveryIgdbClient } from './recommendations/discovery-igdb-client.js';
import { RecommendationRepository } from './recommendations/repository.js';
import { RecommendationService } from './recommendations/service.js';
import { RecommendationTarget } from './recommendations/types.js';
import { releaseMonitorInternals } from './release-monitor.js';

const RECOMMENDATION_SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
const RECOMMENDATION_TARGETS: RecommendationTarget[] = ['BACKLOG', 'WISHLIST', 'DISCOVERY'];

function readDiscoveryEnrichmentApiBaseUrl(): string {
  const raw =
    typeof process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL === 'string'
      ? process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL.trim()
      : '';

  if (raw.length > 0) {
    return raw;
  }

  return 'http://api:3000';
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecommendationTarget(value: unknown): value is RecommendationTarget {
  return value === 'BACKLOG' || value === 'WISHLIST' || value === 'DISCOVERY';
}

async function main(): Promise<void> {
  const pool = await createPool(config.postgresUrl);
  const jobs = new BackgroundJobRepository(pool);
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
  const discoveryEnrichmentService = new DiscoveryEnrichmentService(recommendationRepository, {
    enabled: config.recommendationsDiscoveryEnrichEnabled,
    startupDelayMs: config.recommendationsDiscoveryEnrichStartupDelayMs,
    intervalMinutes: config.recommendationsDiscoveryEnrichIntervalMinutes,
    maxGamesPerRun: config.recommendationsDiscoveryEnrichMaxGamesPerRun,
    requestTimeoutMs: config.recommendationsDiscoveryEnrichRequestTimeoutMs,
    apiBaseUrl: readDiscoveryEnrichmentApiBaseUrl(),
    maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
    backoffBaseMinutes: config.recommendationsDiscoveryEnrichBackoffBaseMinutes,
    backoffMaxHours: config.recommendationsDiscoveryEnrichBackoffMaxHours,
    rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
    rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears
  });
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
  const metadataEnrichmentClient = new MetadataEnrichmentIgdbClient({
    twitchClientId: config.twitchClientId,
    twitchClientSecret: config.twitchClientSecret,
    requestTimeoutMs: config.igdbMetadataEnrichRequestTimeoutMs
  });
  const metadataEnrichmentRepository = new MetadataEnrichmentRepository(pool);
  const metadataEnrichmentService = new MetadataEnrichmentService(
    metadataEnrichmentRepository,
    metadataEnrichmentClient,
    {
      enabled: config.igdbMetadataEnrichEnabled,
      batchSize: config.igdbMetadataEnrichBatchSize,
      maxGamesPerRun: config.igdbMetadataEnrichMaxGamesPerRun,
      startupDelayMs: config.igdbMetadataEnrichStartupDelayMs
    }
  );
  const workerId = `background-worker:${String(process.pid)}`;
  const recommendationConcurrency = readPositiveIntegerEnv('RECOMMENDATIONS_JOB_CONCURRENCY', 1);
  const metadataConcurrency = readPositiveIntegerEnv('METADATA_ENRICHMENT_JOB_CONCURRENCY', 1);
  const releaseMonitorConcurrency = readPositiveIntegerEnv('RELEASE_MONITOR_JOB_CONCURRENCY', 2);
  const metadataIntervalMinutes = readPositiveIntegerEnv(
    'METADATA_ENRICHMENT_QUEUE_INTERVAL_MINUTES',
    60
  );

  let shuttingDown = false;
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.info('[background-worker] stopping', { signal });
    discoveryEnrichmentService.stop();
    await pool.end();
  };

  process.on('SIGINT', () => {
    void stop('SIGINT').finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void stop('SIGTERM').finally(() => process.exit(0));
  });

  const runRecommendationSchedulerTick = async (): Promise<void> => {
    if (!config.recommendationsSchedulerEnabled) {
      return;
    }
    for (const target of RECOMMENDATION_TARGETS) {
      try {
        await recommendationService.ensureRebuildQueuedIfStale(target, 'scheduler');
      } catch (error) {
        console.error('[background-worker] recommendation_scheduler_tick_failed', {
          target,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };

  const scheduleMetadataJob = async (): Promise<void> => {
    if (!config.igdbMetadataEnrichEnabled) {
      return;
    }
    await jobs.enqueue({
      jobType: 'metadata_enrichment_run',
      dedupeKey: 'metadata-enrichment:run',
      payload: {
        requestedAt: new Date().toISOString(),
        requestedBy: 'background-worker'
      },
      priority: 90,
      maxAttempts: 3
    });
  };

  const dispatchJob = async (job: ClaimedBackgroundJob): Promise<Record<string, unknown>> => {
    switch (job.jobType) {
      case 'recommendations_rebuild': {
        const target = job.payload['target'];
        if (!isRecommendationTarget(target)) {
          throw new Error('Invalid recommendations_rebuild job payload target.');
        }
        const triggeredBy =
          job.payload['triggeredBy'] === 'manual' ||
          job.payload['triggeredBy'] === 'scheduler' ||
          job.payload['triggeredBy'] === 'stale-read'
            ? job.payload['triggeredBy']
            : 'manual';
        const result = await recommendationService.rebuild({
          target,
          force: job.payload['force'] === true,
          triggeredBy
        });
        return { runResult: result };
      }
      case 'metadata_enrichment_run': {
        const summary = await metadataEnrichmentService.runOnce();
        return { summary };
      }
      case 'release_monitor_game': {
        await releaseMonitorInternals.processQueuedReleaseMonitorGame(pool, job.payload);
        return { processed: true };
      }
      default: {
        const unknownType: never = job.jobType;
        throw new Error(`Unsupported job type: ${String(unknownType)}`);
      }
    }
  };

  const startConsumers = (jobType: BackgroundJobType, concurrency: number): void => {
    for (let index = 0; index < concurrency; index += 1) {
      void (async () => {
        while (!shuttingDown) {
          let claimed: ClaimedBackgroundJob | null = null;
          try {
            claimed = await jobs.claimNext(workerId, jobType);
          } catch (error) {
            console.error('[background-worker] claim_failed', {
              jobType,
              error: error instanceof Error ? error.message : String(error)
            });
            await sleep(1_000);
            continue;
          }

          if (!claimed) {
            await sleep(500);
            continue;
          }

          try {
            const result = await dispatchJob(claimed);
            await jobs.complete(claimed.id, result);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await jobs.fail(claimed.id, message);
          }
        }
      })();
    }
  };

  startConsumers('recommendations_rebuild', recommendationConcurrency);
  startConsumers('metadata_enrichment_run', metadataConcurrency);
  startConsumers('release_monitor_game', releaseMonitorConcurrency);

  void runRecommendationSchedulerTick();
  const recommendationSchedulerTimer = setInterval(() => {
    void runRecommendationSchedulerTick();
  }, RECOMMENDATION_SCHEDULER_INTERVAL_MS);

  setTimeout(
    () => {
      void scheduleMetadataJob();
    },
    Math.max(0, config.igdbMetadataEnrichStartupDelayMs)
  );
  const metadataTimer = setInterval(
    () => {
      void scheduleMetadataJob();
    },
    Math.max(1, metadataIntervalMinutes) * 60 * 1000
  );

  console.info('[background-worker] started', {
    recommendationSchedulerEnabled: config.recommendationsSchedulerEnabled,
    recommendationConcurrency,
    metadataConcurrency,
    releaseMonitorConcurrency,
    metadataEnabled: config.igdbMetadataEnrichEnabled,
    metadataIntervalMinutes,
    discoveryEnabled: config.recommendationsDiscoveryEnabled,
    discoveryEnrichEnabled: config.recommendationsDiscoveryEnrichEnabled,
    discoveryEnrichApiBaseUrl: readDiscoveryEnrichmentApiBaseUrl()
  });

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (shuttingDown) {
        clearInterval(interval);
        clearInterval(recommendationSchedulerTimer);
        clearInterval(metadataTimer);
        resolve();
      }
    }, 250);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main().catch((error: unknown) => {
  console.error('[background-worker] fatal', error);
  process.exit(1);
});
