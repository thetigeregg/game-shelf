import { config } from './config.js';
import { createPool } from './db.js';
import { OpenAiEmbeddingClient } from './recommendations/embedding-client.js';
import { DiscoveryEnrichmentService } from './recommendations/discovery-enrichment-service.js';
import { DiscoveryIgdbClient } from './recommendations/discovery-igdb-client.js';
import { RecommendationRepository } from './recommendations/repository.js';
import { RecommendationScheduler } from './recommendations/scheduler.js';
import { RecommendationService } from './recommendations/service.js';

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

async function main(): Promise<void> {
  const pool = await createPool(config.postgresUrl);
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
  const recommendationScheduler = new RecommendationScheduler(recommendationService, {
    enabled: config.recommendationsSchedulerEnabled
  });

  let shuttingDown = false;
  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.info('[recommendations-worker] stopping', { signal });
    recommendationScheduler.stop();
    discoveryEnrichmentService.stop();
    await pool.end();
  };

  process.on('SIGINT', () => {
    void stop('SIGINT').finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void stop('SIGTERM').finally(() => process.exit(0));
  });

  recommendationScheduler.start();

  console.info('[recommendations-worker] started', {
    schedulerEnabled: config.recommendationsSchedulerEnabled,
    discoveryEnabled: config.recommendationsDiscoveryEnabled,
    discoveryEnrichEnabled: config.recommendationsDiscoveryEnrichEnabled,
    discoveryEnrichApiBaseUrl: readDiscoveryEnrichmentApiBaseUrl()
  });

  if (!config.recommendationsSchedulerEnabled) {
    console.info('[recommendations-worker] scheduler disabled; waiting for shutdown signal');
  }

  await new Promise<void>(() => undefined);
}

main().catch((error: unknown) => {
  console.error('[recommendations-worker] fatal', error);
  process.exit(1);
});
