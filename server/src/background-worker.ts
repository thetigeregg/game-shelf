import {
  BackgroundJobRepository,
  BackgroundJobType,
  ClaimedBackgroundJob,
} from './background-jobs.js';
import { config } from './config.js';
import { createPool } from './db.js';
import { MetadataEnrichmentIgdbClient } from './metadata-enrichment/igdb-client.js';
import { MetadataEnrichmentRepository } from './metadata-enrichment/repository.js';
import { MetadataEnrichmentService } from './metadata-enrichment/service.js';
import { PopularityIngestService } from './popularity/ingest-service.js';
import { processQueuedIgdbCacheRevalidation } from './igdb-cache.js';
import { processQueuedHltbCacheRevalidation } from './hltb-cache.js';
import { processQueuedManualsCatalogRefresh } from './manuals.js';
import { processQueuedMetacriticCacheRevalidation } from './metacritic-cache.js';
import { processQueuedMobyGamesCacheRevalidation } from './mobygames-cache.js';
import { processQueuedPspricesPriceRevalidation } from './psprices-prices.js';
import { isProviderMatchLocked } from './provider-match-lock.js';
import { resolvePreferredPsPricesUrl } from './psprices-url.js';
import { OpenAiEmbeddingClient } from './recommendations/embedding-client.js';
import { DiscoveryEnrichmentService } from './recommendations/discovery-enrichment-service.js';
import { DiscoveryIgdbClient } from './recommendations/discovery-igdb-client.js';
import {
  maybeRearmProviderRetryState,
  parseProviderRetryState,
  shouldAttemptProvider,
} from './recommendations/provider-retry-state.js';
import { RecommendationRepository } from './recommendations/repository.js';
import { RecommendationService } from './recommendations/service.js';
import { processQueuedSteamPriceRevalidation } from './steam-prices.js';
import {
  DISCOVERY_RECOMMENDATION_ALLOWED_STATUSES,
  RecommendationRuntimeMode,
  RecommendationTarget,
} from './recommendations/types.js';
import { releaseMonitorInternals } from './release-monitor.js';
import { installSingleLineConsole } from './single-line-console.js';
import type { QueryResultRow } from 'pg';

const RECOMMENDATION_SCHEDULER_INTERVAL_MS = 15 * 60 * 1000;
const RECOMMENDATION_TARGETS: RecommendationTarget[] = ['BACKLOG', 'WISHLIST', 'DISCOVERY'];
const DISCOVERY_RUNTIME_MODES: RecommendationRuntimeMode[] = ['NEUTRAL', 'SHORT', 'LONG'];
const STEAM_WINDOWS_PLATFORM_IGDB_ID = 6;
const PSPRICES_PLATFORM_IGDB_IDS = new Set<number>([48, 167, 130, 508]);
const POPULARITY_PRIMITIVE_LIMIT = 500;

if (process.env.NODE_ENV !== 'test') {
  installSingleLineConsole();
}

interface PricingRefreshCandidateRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: unknown;
}

interface PricingRefreshEnqueueStats {
  considered: number;
  staleEligible: number;
  enqueued: number;
  deduped: number;
  skippedMissingData: number;
  skippedBackoff: number;
}
export type BackgroundWorkerMode = 'all' | 'general' | 'recommendations';

export function readDiscoveryEnrichmentApiBaseUrl(): string {
  const raw =
    typeof process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL === 'string'
      ? process.env.RECOMMENDATIONS_ENRICH_API_BASE_URL.trim()
      : '';

  if (raw.length > 0) {
    return raw;
  }

  return 'http://api:3000';
}

export function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = typeof process.env[name] === 'string' ? process.env[name].trim() : '';
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isRecommendationTarget(value: unknown): value is RecommendationTarget {
  return value === 'BACKLOG' || value === 'WISHLIST' || value === 'DISCOVERY';
}

export function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readDiscoveryEnrichmentGameKeys(payload: Record<string, unknown>): string[] | null {
  const value = payload['gameKeys'];
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = [
    ...new Set(
      value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    ),
  ];
  return normalized.length > 0 ? normalized : null;
}

export function readDiscoveryEnrichmentProviders(
  payload: Record<string, unknown>
): Array<'hltb' | 'review' | 'steam'> | null {
  const value = payload['providers'];
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = [
    ...new Set(
      value.filter(
        (item): item is 'hltb' | 'review' | 'steam' =>
          item === 'hltb' || item === 'review' || item === 'steam'
      )
    ),
  ];

  return normalized.length > 0 ? normalized : null;
}

export function shouldRunPricingRefreshPhase(params: {
  enabled: boolean;
  trigger: 'startup' | 'interval';
  nowMs: number;
  lastRunMs: number;
  intervalMinutes: number;
}): boolean {
  if (!params.enabled) {
    return false;
  }
  if (params.trigger === 'startup') {
    return true;
  }
  const intervalMs = Math.max(1, params.intervalMinutes) * 60 * 1000;
  return params.nowMs - params.lastRunMs >= intervalMs;
}

function normalizePayloadObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasUnifiedPriceValue(payload: Record<string, unknown>): boolean {
  if (payload['priceIsFree'] === true) {
    return true;
  }

  const amountCandidate = payload['priceAmount'];
  if (typeof amountCandidate === 'number') {
    return Number.isFinite(amountCandidate) && amountCandidate >= 0;
  }
  if (typeof amountCandidate === 'string') {
    const parsed = Number.parseFloat(amountCandidate.trim());
    return Number.isFinite(parsed) && parsed >= 0;
  }

  return false;
}

function resolvePriceFetchedAtMs(payload: Record<string, unknown>): number | null {
  // Freshness should track successful unified pricing snapshots, not fetch attempts.
  if (!hasUnifiedPriceValue(payload)) {
    return null;
  }

  const candidates = [payload['priceFetchedAt']];

  for (const candidate of candidates) {
    const normalized = normalizeNonEmptyString(candidate);
    if (!normalized) {
      continue;
    }
    const parsedMs = Date.parse(normalized);
    if (Number.isFinite(parsedMs)) {
      return parsedMs;
    }
  }

  return null;
}

function resolvePspricesRevalidationTitle(payload: Record<string, unknown>): string | null {
  return (
    normalizeNonEmptyString(payload['psPricesMatchQueryTitle']) ??
    normalizeNonEmptyString(payload['title'])
  );
}

const resolvePspricesRevalidationUrl = resolvePreferredPsPricesUrl;

function buildPspricesRefreshJob(params: {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
  dedupePrefix: string;
  region: string;
  show: string;
  nowMs: number;
  maxAttempts: number;
  rearmAfterDays: number;
  rearmRecentReleaseYears: number;
}):
  | {
      kind: 'enqueue';
      dedupeKey: string;
      payload: {
        cacheKey: string;
        igdbGameId: string;
        platformIgdbId: number;
        title: string;
        psPricesUrl: string | null;
      };
    }
  | { kind: 'skip'; reason: 'unsupported-platform' | 'backoff' | 'missing-data' } {
  if (!PSPRICES_PLATFORM_IGDB_IDS.has(params.platformIgdbId)) {
    return { kind: 'skip', reason: 'unsupported-platform' };
  }

  if (
    !shouldSchedulePspricesRefresh({
      payload: params.payload,
      platformIgdbId: params.platformIgdbId,
      nowMs: params.nowMs,
      maxAttempts: params.maxAttempts,
      rearmAfterDays: params.rearmAfterDays,
      rearmRecentReleaseYears: params.rearmRecentReleaseYears,
    })
  ) {
    return { kind: 'skip', reason: 'backoff' };
  }

  const title = resolvePspricesRevalidationTitle(params.payload);
  if (!title) {
    return { kind: 'skip', reason: 'missing-data' };
  }

  const cacheKey = `${params.dedupePrefix}:${params.igdbGameId}:${String(params.platformIgdbId)}:${params.region}:${params.show}`;
  return {
    kind: 'enqueue',
    dedupeKey: `${params.dedupePrefix}:psprices:${params.igdbGameId}:${String(params.platformIgdbId)}:${params.region}:${params.show}`,
    payload: {
      cacheKey,
      igdbGameId: params.igdbGameId,
      platformIgdbId: params.platformIgdbId,
      title,
      psPricesUrl: resolvePspricesRevalidationUrl(params.payload),
    },
  };
}

export const __backgroundWorkerTestables = {
  hasUnifiedPriceValue,
  resolvePriceFetchedAtMs,
  resolvePspricesRevalidationTitle,
  resolvePspricesRevalidationUrl,
  buildPspricesRefreshJob,
  isProviderMatchLocked,
  readDiscoveryEnrichmentProviders,
  shouldSchedulePspricesRefresh,
};

function resolvePayloadReleaseYear(payload: Record<string, unknown>): number | null {
  const candidate = payload['releaseYear'];
  if (typeof candidate === 'number') {
    return Number.isInteger(candidate) ? candidate : null;
  }

  if (typeof candidate === 'string' && /^\d{4}$/.test(candidate.trim())) {
    return Number.parseInt(candidate.trim(), 10);
  }

  return null;
}

function shouldSchedulePspricesRefresh(params: {
  payload: Record<string, unknown>;
  platformIgdbId: number;
  nowMs: number;
  maxAttempts: number;
  rearmAfterDays: number;
  rearmRecentReleaseYears: number;
}): boolean {
  if (!PSPRICES_PLATFORM_IGDB_IDS.has(params.platformIgdbId)) {
    return false;
  }

  if (params.payload['listType'] !== 'discovery') {
    return true;
  }

  const retryState = maybeRearmProviderRetryState({
    state: parseProviderRetryState(
      params.payload['enrichmentRetry'] &&
        typeof params.payload['enrichmentRetry'] === 'object' &&
        !Array.isArray(params.payload['enrichmentRetry'])
        ? (params.payload['enrichmentRetry'] as Record<string, unknown>)['psprices']
        : null
    ),
    nowMs: params.nowMs,
    releaseYear: resolvePayloadReleaseYear(params.payload),
    rearmAfterDays: params.rearmAfterDays,
    rearmRecentReleaseYears: params.rearmRecentReleaseYears,
    maxAttempts: params.maxAttempts,
  });

  return shouldAttemptProvider({
    state: retryState,
    nowMs: params.nowMs,
    maxAttempts: params.maxAttempts,
  });
}

export function readBackgroundWorkerMode(): BackgroundWorkerMode {
  const rawValue =
    typeof process.env.BACKGROUND_WORKER_MODE === 'string'
      ? process.env.BACKGROUND_WORKER_MODE
      : '';
  const raw = rawValue.trim().toLowerCase();

  if (raw === 'general' || raw === 'recommendations' || raw === 'all') {
    return raw;
  }

  if (raw.length > 0) {
    console.warn('[background-worker] invalid BACKGROUND_WORKER_MODE; falling back to all', {
      rawValue,
    });
  }

  return 'all';
}

/* node:coverage disable */
async function main(): Promise<void> {
  const workerMode = readBackgroundWorkerMode();
  const runGeneralWork = workerMode === 'all' || workerMode === 'general';
  const runRecommendationRebuildWork = workerMode === 'all' || workerMode === 'recommendations';
  console.info('[background-worker] starting', {
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV ?? '',
    workerMode,
    runGeneralWork,
    runRecommendationRebuildWork,
  });
  const pool = await createPool(config.postgresUrl);
  const jobs = new BackgroundJobRepository(pool);
  const recommendationRepository = new RecommendationRepository(pool);
  const embeddingClient = new OpenAiEmbeddingClient({
    apiKey: config.openaiApiKey,
    model: config.recommendationsEmbeddingModel,
    dimensions: config.recommendationsEmbeddingDimensions,
    timeoutMs: config.recommendationsEmbeddingTimeoutMs,
  });
  const discoveryIgdbClient = new DiscoveryIgdbClient({
    twitchClientId: config.twitchClientId,
    twitchClientSecret: config.twitchClientSecret,
    requestTimeoutMs: config.recommendationsDiscoveryIgdbRequestTimeoutMs,
    maxRequestsPerSecond: config.recommendationsDiscoveryIgdbMaxRequestsPerSecond,
  });
  const metadataEnrichmentClient = new MetadataEnrichmentIgdbClient({
    twitchClientId: config.twitchClientId,
    twitchClientSecret: config.twitchClientSecret,
    requestTimeoutMs: config.igdbMetadataEnrichRequestTimeoutMs,
  });
  const discoveryEnrichmentService = new DiscoveryEnrichmentService(
    recommendationRepository,
    {
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
      rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears,
    },
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
      discoveryIgdbMaxRequestsPerSecond: config.recommendationsDiscoveryIgdbMaxRequestsPerSecond,
    },
    {
      embeddingClient,
      discoveryClient: discoveryIgdbClient,
      discoveryEnrichmentService,
    }
  );
  const metadataEnrichmentRepository = new MetadataEnrichmentRepository(pool);
  const metadataEnrichmentService = new MetadataEnrichmentService(
    metadataEnrichmentRepository,
    metadataEnrichmentClient,
    {
      enabled: config.igdbMetadataEnrichEnabled,
      batchSize: config.igdbMetadataEnrichBatchSize,
      maxGamesPerRun: config.igdbMetadataEnrichMaxGamesPerRun,
      startupDelayMs: config.igdbMetadataEnrichStartupDelayMs,
    }
  );
  const popularityIngestService = new PopularityIngestService(pool, {
    enabled: config.popularityIngestEnabled,
    signalLimit: POPULARITY_PRIMITIVE_LIMIT,
    twitchClientId: config.twitchClientId,
    twitchClientSecret: config.twitchClientSecret,
    requestTimeoutMs: config.popularityIngestIgdbRequestTimeoutMs,
    maxRequestsPerSecond: config.popularityIngestIgdbMaxRequestsPerSecond,
  });
  const workerHost = typeof process.env.HOSTNAME === 'string' ? process.env.HOSTNAME : '';
  const workerId = `background-worker:${workerMode}:${workerHost}:${String(process.pid)}`;
  const recommendationConcurrency = readPositiveIntegerEnv('RECOMMENDATIONS_JOB_CONCURRENCY', 1);
  const metadataConcurrency = readPositiveIntegerEnv('METADATA_ENRICHMENT_JOB_CONCURRENCY', 1);
  const releaseMonitorConcurrency = readPositiveIntegerEnv('RELEASE_MONITOR_JOB_CONCURRENCY', 2);
  const discoveryEnrichmentConcurrency = readPositiveIntegerEnv(
    'DISCOVERY_ENRICHMENT_JOB_CONCURRENCY',
    1
  );
  const popularityIngestConcurrency = readPositiveIntegerEnv(
    'POPULARITY_INGEST_JOB_CONCURRENCY',
    1
  );
  const cacheRevalidationConcurrency = readPositiveIntegerEnv(
    'CACHE_REVALIDATION_JOB_CONCURRENCY',
    2
  );
  const manualsCatalogConcurrency = readPositiveIntegerEnv('MANUALS_CATALOG_JOB_CONCURRENCY', 1);
  const metadataIntervalMinutes = readPositiveIntegerEnv(
    'METADATA_ENRICHMENT_QUEUE_INTERVAL_MINUTES',
    60
  );
  const popularityIngestIntervalMinutes = readPositiveIntegerEnv(
    'POPULARITY_INGEST_INTERVAL_MINUTES',
    config.popularityIngestIntervalMinutes
  );
  const jobsRetentionDays = readPositiveIntegerEnv('BACKGROUND_JOBS_RETENTION_DAYS', 30);
  const jobsCleanupIntervalMinutes = readPositiveIntegerEnv(
    'BACKGROUND_JOBS_CLEANUP_INTERVAL_MINUTES',
    60
  );
  const jobsCleanupBatchSize = readPositiveIntegerEnv('BACKGROUND_JOBS_CLEANUP_BATCH_SIZE', 1000);
  const queueStatsIntervalMinutes = readPositiveIntegerEnv(
    'BACKGROUND_JOBS_STATS_INTERVAL_MINUTES',
    5
  );
  const staleJobRecoveryMinutes = readPositiveIntegerEnv(
    'BACKGROUND_JOBS_STALE_RUNNING_MINUTES',
    30
  );
  const staleJobRecoveryIntervalMinutes = readPositiveIntegerEnv(
    'BACKGROUND_JOBS_STALE_RECOVERY_INTERVAL_MINUTES',
    5
  );
  const recommendationRunRecoveryMinutes = readPositiveIntegerEnv(
    'RECOMMENDATION_RUN_STALE_MINUTES',
    30
  );
  const backgroundJobHeartbeatSeconds = readPositiveIntegerEnv(
    'BACKGROUND_JOBS_LOCK_HEARTBEAT_SECONDS',
    readPositiveIntegerEnv('BACKGROUND_JOB_LOCK_HEARTBEAT_SECONDS', 30)
  );
  const discoveryIntervalMinutes = Math.max(
    1,
    config.recommendationsDiscoveryEnrichIntervalMinutes
  );

  let shuttingDown = false;
  const inFlightJobs = new Set<Promise<void>>();
  const consumerLoops = new Set<Promise<void>>();
  let metadataStartupTimer: ReturnType<typeof setTimeout> | null = null;
  let recommendationSchedulerTimer: ReturnType<typeof setInterval> | null = null;
  let metadataTimer: ReturnType<typeof setInterval> | null = null;
  let popularityIngestTimer: ReturnType<typeof setInterval> | null = null;
  let discoveryEnrichmentTimer: ReturnType<typeof setInterval> | null = null;
  let backgroundJobsCleanupTimer: ReturnType<typeof setInterval> | null = null;
  let queueStatsTimer: ReturnType<typeof setInterval> | null = null;
  let staleJobRecoveryTimer: ReturnType<typeof setInterval> | null = null;
  let pricingRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let lastWishlistPricingRefreshRunMs = 0;
  let lastDiscoveryPricingRefreshRunMs = 0;

  const stopTimers = (): void => {
    if (metadataStartupTimer) {
      clearTimeout(metadataStartupTimer);
      metadataStartupTimer = null;
    }
    if (recommendationSchedulerTimer) {
      clearInterval(recommendationSchedulerTimer);
      recommendationSchedulerTimer = null;
    }
    if (metadataTimer) {
      clearInterval(metadataTimer);
      metadataTimer = null;
    }
    if (popularityIngestTimer) {
      clearInterval(popularityIngestTimer);
      popularityIngestTimer = null;
    }
    if (discoveryEnrichmentTimer) {
      clearInterval(discoveryEnrichmentTimer);
      discoveryEnrichmentTimer = null;
    }
    if (backgroundJobsCleanupTimer) {
      clearInterval(backgroundJobsCleanupTimer);
      backgroundJobsCleanupTimer = null;
    }
    if (queueStatsTimer) {
      clearInterval(queueStatsTimer);
      queueStatsTimer = null;
    }
    if (staleJobRecoveryTimer) {
      clearInterval(staleJobRecoveryTimer);
      staleJobRecoveryTimer = null;
    }
    if (pricingRefreshTimer) {
      clearInterval(pricingRefreshTimer);
      pricingRefreshTimer = null;
    }
  };

  const stop = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.info('[background-worker] stopping', { signal });
    stopTimers();
    discoveryEnrichmentService.stop();
    await Promise.allSettled(Array.from(consumerLoops));
    await Promise.allSettled(Array.from(inFlightJobs));
    let dbPoolClosed = false;
    let poolCloseErrorMessage: string | null = null;
    try {
      await pool.end();
      dbPoolClosed = true;
    } catch (error) {
      poolCloseErrorMessage = error instanceof Error ? error.message : String(error);
      console.error('[background-worker] failed to close database pool during shutdown', {
        signal,
        error: poolCloseErrorMessage,
      });
    }
    console.info('[background-worker] stopped', {
      signal,
      dbPoolClosed,
      poolCloseErrorMessage,
    });
  };

  process.on('SIGINT', () => {
    void stop('SIGINT').finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void stop('SIGTERM').finally(() => process.exit(0));
  });

  const runRecommendationSchedulerTick = async (): Promise<void> => {
    if (shuttingDown || !config.recommendationsSchedulerEnabled) {
      return;
    }
    const startedAt = Date.now();
    let queuedCount = 0;
    let freshCount = 0;
    let missingCount = 0;
    let staleCount = 0;
    let failedCount = 0;
    const targetResults: Array<Record<string, unknown>> = [];
    for (const target of RECOMMENDATION_TARGETS) {
      try {
        const result = await recommendationService.ensureRebuildQueuedIfStale(target, 'scheduler');
        if (result.reason === 'fresh') {
          freshCount += 1;
        } else if (result.queued) {
          queuedCount += 1;
          if (result.reason === 'missing') {
            missingCount += 1;
          } else if (result.reason === 'stale') {
            staleCount += 1;
          }
        }
        targetResults.push({
          target,
          queued: result.queued,
          reason: result.reason,
          jobId: result.jobId,
        });
      } catch (error) {
        failedCount += 1;
        targetResults.push({
          target,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error('[background-worker] recommendation_scheduler_tick_failed', {
          target,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.info('[background-worker] recommendation_scheduler_tick', {
      queuedCount,
      freshCount,
      missingCount,
      staleCount,
      failedCount,
      durationMs: Date.now() - startedAt,
      targets: targetResults,
    });
  };

  const scheduleMetadataJob = async (): Promise<void> => {
    if (shuttingDown || !config.igdbMetadataEnrichEnabled) {
      return;
    }
    try {
      const enqueueResult = await jobs.enqueue({
        jobType: 'metadata_enrichment_run',
        dedupeKey: 'metadata-enrichment:run',
        payload: {
          requestedAt: new Date().toISOString(),
          requestedBy: 'background-worker',
        },
        priority: 90,
        maxAttempts: 3,
      });
      console.info('[background-worker] metadata_enrichment_enqueue', {
        queued: !enqueueResult.deduped,
        deduped: enqueueResult.deduped,
        jobId: enqueueResult.jobId,
      });
    } catch (error) {
      console.error('[background-worker] metadata_enrichment_enqueue_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const scheduleDiscoveryEnrichmentJob = async (): Promise<void> => {
    if (shuttingDown || !config.recommendationsDiscoveryEnrichEnabled) {
      return;
    }
    try {
      const enqueueResult = await jobs.enqueue({
        jobType: 'discovery_enrichment_run',
        dedupeKey: 'discovery-enrichment:run',
        payload: {
          requestedAt: new Date().toISOString(),
          requestedBy: 'background-worker',
        },
        priority: 95,
        maxAttempts: 3,
      });
      console.info('[background-worker] discovery_enrichment_enqueue', {
        queued: !enqueueResult.deduped,
        deduped: enqueueResult.deduped,
        jobId: enqueueResult.jobId,
      });
    } catch (error) {
      console.error('[background-worker] discovery_enrichment_enqueue_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const schedulePopularityIngestJob = async (): Promise<void> => {
    if (shuttingDown || !config.popularityIngestEnabled) {
      return;
    }
    try {
      const enqueueResult = await jobs.enqueue({
        jobType: 'igdb_popularity_ingest',
        dedupeKey: 'igdb-popularity-ingest:run',
        payload: {
          requestedAt: new Date().toISOString(),
          requestedBy: 'background-worker',
        },
        priority: 85,
        maxAttempts: 3,
      });
      console.info('[background-worker] popularity_ingest_enqueue', {
        queued: !enqueueResult.deduped,
        deduped: enqueueResult.deduped,
        jobId: enqueueResult.jobId,
      });
    } catch (error) {
      console.error('[background-worker] popularity_ingest_enqueue_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const runBackgroundJobsCleanup = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    try {
      const result = await jobs.purgeFinishedOlderThan({
        retentionDays: jobsRetentionDays,
        limit: jobsCleanupBatchSize,
      });
      if (result.deletedCount > 0) {
        console.info('[background-worker] background_jobs_cleanup', {
          deletedCount: result.deletedCount,
          retentionDays: jobsRetentionDays,
          batchSize: jobsCleanupBatchSize,
        });
      }
    } catch (error) {
      console.error('[background-worker] background_jobs_cleanup_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const logQueuePressure = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    try {
      const typeStats = await jobs.getTypeStats();
      const totals = typeStats.reduce(
        (acc, row) => ({
          pending: acc.pending + row.pending,
          running: acc.running + row.running,
          failed: acc.failed + row.failed,
          succeeded: acc.succeeded + row.succeeded,
        }),
        { pending: 0, running: 0, failed: 0, succeeded: 0 }
      );
      console.info('[background-worker] queue_pressure', {
        totals,
        byType: typeStats,
      });
    } catch (error) {
      console.error('[background-worker] queue_pressure_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const recoverStaleWork = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    try {
      const staleJobs = await jobs.requeueStaleRunning({
        maxAgeMinutes: staleJobRecoveryMinutes,
        recoveryError: 'stale running lock recovered by background worker',
      });
      if (staleJobs.requeuedCount > 0) {
        console.warn('[background-worker] stale_jobs_requeued', {
          requeuedCount: staleJobs.requeuedCount,
          maxAgeMinutes: staleJobRecoveryMinutes,
        });
      }
    } catch (error) {
      console.error('[background-worker] stale_jobs_requeue_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const staleRuns = await recommendationRepository.failStaleRunningRuns({
        maxAgeMinutes: recommendationRunRecoveryMinutes,
        errorMessage: 'orphaned RUNNING run recovered after worker loss',
      });
      if (staleRuns.failedCount > 0) {
        console.warn('[background-worker] stale_recommendation_runs_recovered', {
          failedCount: staleRuns.failedCount,
          maxAgeMinutes: recommendationRunRecoveryMinutes,
        });
      }
    } catch (error) {
      console.error('[background-worker] stale_recommendation_runs_failed_recovery', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const enqueuePricingRefreshForRows = async (params: {
    rows: PricingRefreshCandidateRow[];
    queueLimit: number;
    staleThresholdMs: number;
    dedupePrefix: string;
  }): Promise<PricingRefreshEnqueueStats> => {
    const stats: PricingRefreshEnqueueStats = {
      considered: 0,
      staleEligible: 0,
      enqueued: 0,
      deduped: 0,
      skippedMissingData: 0,
      skippedBackoff: 0,
    };
    const steamCountry = config.steamDefaultCountry;
    const pspricesRegion = config.pspricesRegionPath.toLowerCase();
    const pspricesShow = config.pspricesShow.toLowerCase();
    const nowMs = Date.now();

    for (const row of params.rows) {
      if (stats.enqueued >= params.queueLimit) {
        break;
      }

      const payload = normalizePayloadObject(row.payload);
      if (!payload) {
        continue;
      }
      stats.considered += 1;

      const fetchedAtMs = resolvePriceFetchedAtMs(payload);
      if (fetchedAtMs !== null && fetchedAtMs > params.staleThresholdMs) {
        continue;
      }
      stats.staleEligible += 1;

      if (row.platform_igdb_id === STEAM_WINDOWS_PLATFORM_IGDB_ID) {
        const steamAppId = normalizePositiveInteger(payload['steamAppId']);
        if (steamAppId === null) {
          stats.skippedMissingData += 1;
          continue;
        }

        const dedupeKey = `${params.dedupePrefix}:steam:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${steamCountry}:${String(steamAppId)}`;
        const enqueueResult = await jobs.enqueue({
          jobType: 'steam_price_revalidate',
          dedupeKey,
          payload: {
            cacheKey: `${params.dedupePrefix}:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${steamCountry}:${String(steamAppId)}`,
            igdbGameId: row.igdb_game_id,
            platformIgdbId: row.platform_igdb_id,
            cc: steamCountry,
            steamAppId,
          },
          priority: 120,
          maxAttempts: 3,
        });

        if (enqueueResult.deduped) {
          stats.deduped += 1;
        } else {
          stats.enqueued += 1;
        }
        continue;
      }

      const pspricesRefreshJob = buildPspricesRefreshJob({
        igdbGameId: row.igdb_game_id,
        platformIgdbId: row.platform_igdb_id,
        payload,
        dedupePrefix: params.dedupePrefix,
        region: pspricesRegion,
        show: pspricesShow,
        nowMs,
        maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
        rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
        rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears,
      });
      if (
        pspricesRefreshJob.kind === 'skip' &&
        pspricesRefreshJob.reason === 'unsupported-platform'
      ) {
        continue;
      }

      if (pspricesRefreshJob.kind === 'skip' && pspricesRefreshJob.reason === 'backoff') {
        stats.skippedBackoff += 1;
        continue;
      }

      if (pspricesRefreshJob.kind === 'skip') {
        stats.skippedMissingData += 1;
        continue;
      }

      const enqueueResult = await jobs.enqueue({
        jobType: 'psprices_price_revalidate',
        dedupeKey: pspricesRefreshJob.dedupeKey,
        payload: pspricesRefreshJob.payload,
        priority: 120,
        maxAttempts: 3,
      });

      if (enqueueResult.deduped) {
        stats.deduped += 1;
      } else {
        stats.enqueued += 1;
      }
    }

    return stats;
  };

  const scheduleWishlistPricingRefreshJobs =
    async (): Promise<PricingRefreshEnqueueStats | null> => {
      if (shuttingDown) {
        return null;
      }

      const startedAt = Date.now();
      const staleThresholdMs =
        Date.now() - Math.max(1, config.pricingRefreshStaleHours) * 3600 * 1000;
      const scanLimit = Math.max(1, Math.min(5000, config.pricingRefreshBatchSize * 5));
      const queueLimit = Math.max(1, Math.min(1000, config.pricingRefreshBatchSize));

      try {
        const rows = await pool.query<PricingRefreshCandidateRow>(
          `
        SELECT igdb_game_id, platform_igdb_id, payload
        FROM games
        WHERE payload->>'listType' = 'wishlist'
          AND (platform_igdb_id = $1 OR platform_igdb_id = ANY($2::int[]))
        ORDER BY updated_at ASC
        LIMIT $3
        `,
          [STEAM_WINDOWS_PLATFORM_IGDB_ID, [...PSPRICES_PLATFORM_IGDB_IDS], scanLimit]
        );

        const stats = await enqueuePricingRefreshForRows({
          rows: rows.rows,
          queueLimit,
          staleThresholdMs,
          dedupePrefix: 'pricing-refresh:wishlist',
        });

        console.info('[background-worker] pricing_refresh_wishlist_phase_done', {
          ...stats,
          batchSize: queueLimit,
          staleHours: config.pricingRefreshStaleHours,
          durationMs: Date.now() - startedAt,
          marker: 'wishlist_phase_done',
        });

        return stats;
      } catch (error) {
        console.error('[background-worker] pricing_refresh_wishlist_phase_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };

  const scheduleDiscoveryPricingRefreshJobs =
    async (): Promise<PricingRefreshEnqueueStats | null> => {
      if (shuttingDown) {
        return null;
      }

      const startedAt = Date.now();
      const staleThresholdMs =
        Date.now() - Math.max(1, config.discoveryPricingRefreshStaleHours) * 3600 * 1000;
      const queueLimit = Math.max(1, Math.min(1000, config.discoveryPricingRefreshBatchSize));
      const scanLimit = Math.max(1, Math.min(5000, config.discoveryPricingRefreshBatchSize * 5));
      const perModeTopLimit = Math.max(1, config.recommendationsTopLimit);

      try {
        const rows = await pool.query<PricingRefreshCandidateRow>(
          `
        WITH latest_run AS (
          SELECT id
          FROM recommendation_runs
          WHERE target = 'DISCOVERY' AND status = 'SUCCESS'
          ORDER BY started_at DESC
          LIMIT 1
        ),
        ranked AS (
          SELECT
            recommendations.runtime_mode,
            recommendations.igdb_game_id,
            recommendations.platform_igdb_id,
            ROW_NUMBER() OVER (
              PARTITION BY recommendations.runtime_mode
              ORDER BY recommendations.rank ASC
            ) AS runtime_rank
          FROM recommendations
          INNER JOIN latest_run ON latest_run.id = recommendations.run_id
          INNER JOIN games
            ON games.igdb_game_id = recommendations.igdb_game_id
           AND games.platform_igdb_id = recommendations.platform_igdb_id
          WHERE recommendations.runtime_mode = ANY($1::text[])
            AND COALESCE(games.payload->>'listType', '') = 'discovery'
            AND COALESCE(games.payload->>'status', '') = ANY($2::text[])
        ),
        deduped AS (
          SELECT DISTINCT igdb_game_id, platform_igdb_id
          FROM ranked
          WHERE runtime_rank <= $3
        )
        SELECT games.igdb_game_id, games.platform_igdb_id, games.payload
        FROM deduped
        INNER JOIN games
          ON games.igdb_game_id = deduped.igdb_game_id
         AND games.platform_igdb_id = deduped.platform_igdb_id
        WHERE COALESCE(games.payload->>'listType', '') = 'discovery'
        ORDER BY games.updated_at ASC
        LIMIT $4
        `,
          [
            DISCOVERY_RUNTIME_MODES,
            [...DISCOVERY_RECOMMENDATION_ALLOWED_STATUSES],
            perModeTopLimit,
            scanLimit,
          ]
        );

        const stats = await enqueuePricingRefreshForRows({
          rows: rows.rows,
          queueLimit,
          staleThresholdMs,
          dedupePrefix: 'pricing-refresh:discovery',
        });

        console.info('[background-worker] pricing_refresh_discovery_phase_done', {
          ...stats,
          batchSize: queueLimit,
          staleHours: config.discoveryPricingRefreshStaleHours,
          discoveryRuntimeModes: DISCOVERY_RUNTIME_MODES,
          perModeTopLimit,
          durationMs: Date.now() - startedAt,
          marker: 'discovery_phase_done',
        });

        return stats;
      } catch (error) {
        console.error('[background-worker] pricing_refresh_discovery_phase_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };

  const runPricingRefreshCycle = async (trigger: 'startup' | 'interval'): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    const cycleStartedAt = Date.now();
    const nowMs = Date.now();
    const shouldRunWishlist = shouldRunPricingRefreshPhase({
      enabled: config.pricingRefreshEnabled,
      trigger,
      nowMs,
      lastRunMs: lastWishlistPricingRefreshRunMs,
      intervalMinutes: config.pricingRefreshIntervalMinutes,
    });
    const shouldRunDiscovery = shouldRunPricingRefreshPhase({
      enabled: config.discoveryPricingRefreshEnabled,
      trigger,
      nowMs,
      lastRunMs: lastDiscoveryPricingRefreshRunMs,
      intervalMinutes: config.discoveryPricingRefreshIntervalMinutes,
    });

    let wishlistStats: PricingRefreshEnqueueStats | null = null;
    let discoveryStats: PricingRefreshEnqueueStats | null = null;

    if (shouldRunWishlist) {
      wishlistStats = await scheduleWishlistPricingRefreshJobs();
      if (wishlistStats !== null) {
        lastWishlistPricingRefreshRunMs = Date.now();
      }
    }

    if (shouldRunDiscovery) {
      discoveryStats = await scheduleDiscoveryPricingRefreshJobs();
      if (discoveryStats !== null) {
        lastDiscoveryPricingRefreshRunMs = Date.now();
      }
    }

    if (!shouldRunWishlist && !shouldRunDiscovery) {
      return;
    }

    console.info('[background-worker] pricing_refresh_cycle_done', {
      trigger,
      shouldRunWishlist,
      shouldRunDiscovery,
      wishlistEnqueued: wishlistStats?.enqueued ?? 0,
      discoveryEnqueued: discoveryStats?.enqueued ?? 0,
      durationMs: Date.now() - cycleStartedAt,
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
          triggeredBy,
        });
        return { runResult: result };
      }
      case 'metadata_enrichment_run': {
        const summary = await metadataEnrichmentService.runOnce();
        return { summary };
      }
      case 'igdb_popularity_ingest': {
        const summary = await popularityIngestService.runOnce();
        return { summary };
      }
      case 'release_monitor_game': {
        await releaseMonitorInternals.processQueuedReleaseMonitorGame(pool, job.payload);
        return { processed: true };
      }
      case 'discovery_enrichment_run': {
        const gameKeys = readDiscoveryEnrichmentGameKeys(job.payload);
        const providers = readDiscoveryEnrichmentProviders(job.payload);
        const summary =
          gameKeys === null && providers === null
            ? await discoveryEnrichmentService.runOnce()
            : await discoveryEnrichmentService.enrichNow({
                ...(gameKeys !== null ? { limit: Math.max(gameKeys.length, 1) } : {}),
                ...(gameKeys !== null ? { gameKeys } : {}),
                ...(providers !== null ? { providers } : {}),
              });
        return { summary };
      }
      case 'igdb_cache_revalidate': {
        await processQueuedIgdbCacheRevalidation(pool, {
          cacheKey: stringOrEmpty(job.payload['cacheKey']),
          gameId: stringOrEmpty(job.payload['gameId']),
        });
        return { revalidated: true };
      }
      case 'hltb_cache_revalidate': {
        await processQueuedHltbCacheRevalidation(pool, {
          cacheKey: stringOrEmpty(job.payload['cacheKey']),
          requestUrl: stringOrEmpty(job.payload['requestUrl']),
        });
        return { revalidated: true };
      }
      case 'metacritic_cache_revalidate': {
        await processQueuedMetacriticCacheRevalidation(pool, {
          cacheKey: stringOrEmpty(job.payload['cacheKey']),
          requestUrl: stringOrEmpty(job.payload['requestUrl']),
        });
        return { revalidated: true };
      }
      case 'mobygames_cache_revalidate': {
        await processQueuedMobyGamesCacheRevalidation(pool, {
          cacheKey: stringOrEmpty(job.payload['cacheKey']),
          requestUrl: stringOrEmpty(job.payload['requestUrl']),
        });
        return { revalidated: true };
      }
      case 'steam_price_revalidate': {
        await processQueuedSteamPriceRevalidation(pool, {
          cacheKey: stringOrEmpty(job.payload['cacheKey']),
          igdbGameId: stringOrEmpty(job.payload['igdbGameId']),
          platformIgdbId:
            typeof job.payload['platformIgdbId'] === 'number'
              ? job.payload['platformIgdbId']
              : Number.parseInt(stringOrEmpty(job.payload['platformIgdbId']), 10),
          cc: stringOrEmpty(job.payload['cc']),
          steamAppId:
            typeof job.payload['steamAppId'] === 'number'
              ? job.payload['steamAppId']
              : Number.parseInt(stringOrEmpty(job.payload['steamAppId']), 10),
        });
        return { revalidated: true };
      }
      case 'psprices_price_revalidate': {
        await processQueuedPspricesPriceRevalidation(pool, {
          cacheKey: stringOrEmpty(job.payload['cacheKey']),
          igdbGameId: stringOrEmpty(job.payload['igdbGameId']),
          platformIgdbId:
            typeof job.payload['platformIgdbId'] === 'number'
              ? job.payload['platformIgdbId']
              : Number.parseInt(stringOrEmpty(job.payload['platformIgdbId']), 10),
          title: stringOrEmpty(job.payload['title']),
          psPricesUrl: stringOrEmpty(job.payload['psPricesUrl']),
        });
        return { revalidated: true };
      }
      case 'manuals_catalog_refresh': {
        const summary = await processQueuedManualsCatalogRefresh(pool, config.manualsDir);
        return { summary };
      }
      default: {
        const unknownType: never = job.jobType;
        throw new Error(`Unsupported job type: ${String(unknownType)}`);
      }
    }
  };

  const buildJobContext = (job: ClaimedBackgroundJob): Record<string, unknown> => {
    const context: Record<string, unknown> = {
      jobId: job.id,
      jobType: job.jobType,
    };

    if (job.jobType === 'recommendations_rebuild') {
      context.target = job.payload['target'];
      context.force = job.payload['force'] === true;
    } else if (job.jobType === 'release_monitor_game') {
      context.igdbGameId = job.payload['igdbGameId'] ?? job.payload['igdb_game_id'];
      context.platformIgdbId = job.payload['platformIgdbId'] ?? job.payload['platform_igdb_id'];
    } else if (
      job.jobType === 'igdb_cache_revalidate' ||
      job.jobType === 'hltb_cache_revalidate' ||
      job.jobType === 'metacritic_cache_revalidate' ||
      job.jobType === 'mobygames_cache_revalidate' ||
      job.jobType === 'steam_price_revalidate' ||
      job.jobType === 'psprices_price_revalidate'
    ) {
      context.cacheKey = job.payload['cacheKey'];
    }

    return context;
  };

  const startConsumers = (jobType: BackgroundJobType, concurrency: number): void => {
    for (let index = 0; index < concurrency; index += 1) {
      const consumerLoop = (async () => {
        while (!shuttingDown) {
          let claimed: ClaimedBackgroundJob | null = null;
          try {
            claimed = await jobs.claimNext(workerId, jobType);
          } catch (error) {
            console.error('[background-worker] claim_failed', {
              jobType,
              error: error instanceof Error ? error.message : String(error),
            });
            await sleep(1_000);
            continue;
          }

          if (!claimed) {
            await sleep(500);
            continue;
          }

          console.info('[background-worker] job_claimed', buildJobContext(claimed));

          const processClaimedJob = (async () => {
            const startedAt = Date.now();
            const jobContext = buildJobContext(claimed);
            console.info('[background-worker] job_started', jobContext);
            const heartbeatTimer = setInterval(
              () => {
                void jobs
                  .heartbeat(claimed.id, workerId)
                  .then((updated) => {
                    if (!updated) {
                      console.warn('[background-worker] job_heartbeat_missed', jobContext);
                    }
                  })
                  .catch((error: unknown) => {
                    console.warn('[background-worker] job_heartbeat_failed', {
                      ...jobContext,
                      error: error instanceof Error ? error.message : String(error),
                    });
                  });
              },
              Math.max(1, backgroundJobHeartbeatSeconds) * 1000
            );
            try {
              const result = await dispatchJob(claimed);
              await jobs.complete(claimed.id, result);
              console.info('[background-worker] job_succeeded', {
                ...jobContext,
                durationMs: Date.now() - startedAt,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await jobs.fail(claimed.id, message);
              console.error('[background-worker] job_failed', {
                ...jobContext,
                durationMs: Date.now() - startedAt,
                error: message,
              });
            } finally {
              clearInterval(heartbeatTimer);
            }
          })();
          inFlightJobs.add(processClaimedJob);
          try {
            await processClaimedJob;
          } finally {
            inFlightJobs.delete(processClaimedJob);
          }
        }
      })();
      consumerLoops.add(consumerLoop);
      void consumerLoop.finally(() => {
        consumerLoops.delete(consumerLoop);
      });
    }
  };

  if (runRecommendationRebuildWork) {
    startConsumers('recommendations_rebuild', recommendationConcurrency);
  }

  if (runGeneralWork) {
    startConsumers('metadata_enrichment_run', metadataConcurrency);
    startConsumers('igdb_popularity_ingest', popularityIngestConcurrency);
    startConsumers('release_monitor_game', releaseMonitorConcurrency);
    startConsumers('discovery_enrichment_run', discoveryEnrichmentConcurrency);
    startConsumers('igdb_cache_revalidate', cacheRevalidationConcurrency);
    startConsumers('hltb_cache_revalidate', cacheRevalidationConcurrency);
    startConsumers('metacritic_cache_revalidate', cacheRevalidationConcurrency);
    startConsumers('mobygames_cache_revalidate', cacheRevalidationConcurrency);
    startConsumers('steam_price_revalidate', cacheRevalidationConcurrency);
    startConsumers('psprices_price_revalidate', cacheRevalidationConcurrency);
    startConsumers('manuals_catalog_refresh', manualsCatalogConcurrency);

    void runRecommendationSchedulerTick();
    recommendationSchedulerTimer = setInterval(() => {
      void runRecommendationSchedulerTick();
    }, RECOMMENDATION_SCHEDULER_INTERVAL_MS);

    metadataStartupTimer = setTimeout(
      () => {
        void scheduleMetadataJob();
        void schedulePopularityIngestJob();
        void scheduleDiscoveryEnrichmentJob();
      },
      Math.max(0, config.igdbMetadataEnrichStartupDelayMs)
    );
    metadataTimer = setInterval(
      () => {
        void scheduleMetadataJob();
      },
      Math.max(1, metadataIntervalMinutes) * 60 * 1000
    );
    discoveryEnrichmentTimer = setInterval(
      () => {
        void scheduleDiscoveryEnrichmentJob();
      },
      discoveryIntervalMinutes * 60 * 1000
    );
    popularityIngestTimer = setInterval(
      () => {
        void schedulePopularityIngestJob();
      },
      Math.max(1, popularityIngestIntervalMinutes) * 60 * 1000
    );
    backgroundJobsCleanupTimer = setInterval(
      () => {
        void runBackgroundJobsCleanup();
      },
      Math.max(1, jobsCleanupIntervalMinutes) * 60 * 1000
    );
    void runBackgroundJobsCleanup();
    staleJobRecoveryTimer = setInterval(
      () => {
        void recoverStaleWork();
      },
      Math.max(1, staleJobRecoveryIntervalMinutes) * 60 * 1000
    );
    void recoverStaleWork();
    queueStatsTimer = setInterval(
      () => {
        void logQueuePressure();
      },
      Math.max(1, queueStatsIntervalMinutes) * 60 * 1000
    );
    void logQueuePressure();
    const pricingRefreshCycleIntervalMinutes = (() => {
      const intervals: number[] = [];
      if (config.pricingRefreshEnabled) {
        intervals.push(Math.max(1, config.pricingRefreshIntervalMinutes));
      }
      if (config.discoveryPricingRefreshEnabled) {
        intervals.push(Math.max(1, config.discoveryPricingRefreshIntervalMinutes));
      }
      return intervals.length > 0 ? Math.min(...intervals) : 60;
    })();
    pricingRefreshTimer = setInterval(
      () => {
        void runPricingRefreshCycle('interval');
      },
      pricingRefreshCycleIntervalMinutes * 60 * 1000
    );
    void runPricingRefreshCycle('startup');
  }

  console.info('[background-worker] started', {
    recommendationSchedulerEnabled: config.recommendationsSchedulerEnabled,
    recommendationConcurrency,
    metadataConcurrency,
    popularityIngestConcurrency,
    releaseMonitorConcurrency,
    discoveryEnrichmentConcurrency,
    cacheRevalidationConcurrency,
    manualsCatalogConcurrency,
    metadataEnabled: config.igdbMetadataEnrichEnabled,
    popularityIngestEnabled: config.popularityIngestEnabled,
    popularityIngestIntervalMinutes,
    metadataIntervalMinutes,
    backgroundJobsRetentionDays: jobsRetentionDays,
    backgroundJobsCleanupIntervalMinutes: jobsCleanupIntervalMinutes,
    backgroundJobsCleanupBatchSize: jobsCleanupBatchSize,
    queueStatsIntervalMinutes,
    staleJobRecoveryMinutes,
    staleJobRecoveryIntervalMinutes,
    recommendationRunRecoveryMinutes,
    backgroundJobHeartbeatSeconds,
    discoveryIntervalMinutes,
    pricingRefreshCycleEnabled:
      config.pricingRefreshEnabled || config.discoveryPricingRefreshEnabled,
    pricingRefreshEnabled: config.pricingRefreshEnabled,
    pricingRefreshIntervalMinutes: config.pricingRefreshIntervalMinutes,
    pricingRefreshBatchSize: config.pricingRefreshBatchSize,
    pricingRefreshStaleHours: config.pricingRefreshStaleHours,
    discoveryPricingRefreshEnabled: config.discoveryPricingRefreshEnabled,
    discoveryPricingRefreshIntervalMinutes: config.discoveryPricingRefreshIntervalMinutes,
    discoveryPricingRefreshBatchSize: config.discoveryPricingRefreshBatchSize,
    discoveryPricingRefreshStaleHours: config.discoveryPricingRefreshStaleHours,
    workerMode,
    runGeneralWork,
    runRecommendationRebuildWork,
    discoveryEnabled: config.recommendationsDiscoveryEnabled,
    discoveryEnrichEnabled: config.recommendationsDiscoveryEnrichEnabled,
    discoveryEnrichApiBaseUrl: readDiscoveryEnrichmentApiBaseUrl(),
  });

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (shuttingDown) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });
}
/* node:coverage enable */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((error: unknown) => {
    console.error('[background-worker] fatal', error);
    process.exit(1);
  });
}
