import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { parseRecommendationRuntimeMode } from './recommendations/runtime.js';
import {
  DISCOVERY_ENRICHMENT_REARM_AFTER_DAYS_DEFAULT,
  DISCOVERY_ENRICHMENT_REARM_RECENT_RELEASE_YEARS_DEFAULT
} from './recommendations/discovery-enrichment-defaults.js';

const envFile = readEnvFilePath();
loadDotenv({ path: envFile });
const serverRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
}

function readSecretFile(name: string, fallbackSecretName: string): string {
  const filePath = readEnv(`${name}_FILE`, `/run/secrets/${fallbackSecretName}`);
  if (filePath && fs.existsSync(filePath)) {
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read ${name}_FILE: ${message}`);
    }
  }
  return '';
}

function readRequiredSecretFile(name: string, fallbackSecretName: string): string {
  const value = readSecretFile(name, fallbackSecretName);
  if (!value) {
    if (isTestRuntime()) {
      return `test_${name.toLowerCase()}`;
    }
    throw new Error(`Missing required secret file for ${name} (${name}_FILE)`);
  }
  return value;
}

function isTestRuntime(): boolean {
  if (readEnv('NODE_ENV') === 'test') {
    return true;
  }

  return process.argv.includes('--test') || process.execArgv.includes('--test');
}

function readIntegerEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = readEnv(name);

  if (!raw) {
    return fallback;
  }

  const normalized = raw.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function readEnvFilePath(): string {
  const fromEnv = typeof process.env.ENV_FILE === 'string' ? process.env.ENV_FILE.trim() : '';
  const candidate = fromEnv.length > 0 ? fromEnv : '.env';

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(process.cwd(), candidate);
}

export interface AppConfig {
  host: string;
  port: number;
  requestBodyLimitBytes: number;
  globalRateLimitMaxRequests: number;
  globalRateLimitWindowMs: number;
  corsAllowedOrigins: string[];
  postgresUrl: string;
  apiToken: string;
  clientWriteTokens: string[];
  requireAuth: boolean;
  imageCacheDir: string;
  imageCacheTtlSeconds: number;
  imageProxyTimeoutMs: number;
  imageProxyMaxBytes: number;
  imageProxyRateLimitWindowMs: number;
  imageProxyMaxRequestsPerWindow: number;
  imagePurgeMaxRequestsPerWindow: number;
  cacheStatsRateLimitWindowMs: number;
  cacheStatsMaxRequestsPerWindow: number;
  twitchClientId: string;
  twitchClientSecret: string;
  theGamesDbApiKey: string;
  hltbScraperBaseUrl: string;
  hltbScraperToken: string;
  hltbCacheEnableStaleWhileRevalidate: boolean;
  hltbCacheFreshTtlSeconds: number;
  hltbCacheStaleTtlSeconds: number;
  metacriticScraperBaseUrl: string;
  metacriticScraperToken: string;
  metacriticCacheEnableStaleWhileRevalidate: boolean;
  metacriticCacheFreshTtlSeconds: number;
  metacriticCacheStaleTtlSeconds: number;
  hltbSearchRateLimitMaxPerMinute: number;
  metacriticSearchRateLimitMaxPerMinute: number;
  mobygamesApiBaseUrl: string;
  mobygamesApiKey: string;
  steamStoreApiBaseUrl: string;
  steamStoreApiTimeoutMs: number;
  steamDefaultCountry: string;
  steamPriceCacheEnableStaleWhileRevalidate: boolean;
  steamPriceCacheFreshTtlSeconds: number;
  steamPriceCacheStaleTtlSeconds: number;
  pspricesScraperBaseUrl: string;
  pspricesScraperToken: string;
  pspricesRegionPath: string;
  pspricesShow: string;
  pspricesPriceCacheEnableStaleWhileRevalidate: boolean;
  pspricesPriceCacheFreshTtlSeconds: number;
  pspricesPriceCacheStaleTtlSeconds: number;
  pricingRefreshEnabled: boolean;
  pricingRefreshIntervalMinutes: number;
  pricingRefreshBatchSize: number;
  pricingRefreshStaleHours: number;
  discoveryPricingRefreshEnabled: boolean;
  discoveryPricingRefreshIntervalMinutes: number;
  discoveryPricingRefreshBatchSize: number;
  discoveryPricingRefreshStaleHours: number;
  mobygamesCacheEnableStaleWhileRevalidate: boolean;
  mobygamesCacheFreshTtlSeconds: number;
  mobygamesCacheStaleTtlSeconds: number;
  mobygamesSearchRateLimitMaxPerMinute: number;
  manualsDir: string;
  manualsPublicBaseUrl: string;
  firebaseServiceAccountJson: string;
  notificationsTestEndpointEnabled: boolean;
  notificationsObservabilityEndpointEnabled: boolean;
  releaseMonitorEnabled: boolean;
  releaseMonitorIntervalSeconds: number;
  releaseMonitorBatchSize: number;
  releaseMonitorDebugLogs: boolean;
  hltbPeriodicRefreshYears: number;
  hltbPeriodicRefreshDays: number;
  metacriticPeriodicRefreshYears: number;
  metacriticPeriodicRefreshDays: number;
  fcmTokenCleanupEnabled: boolean;
  fcmTokenCleanupIntervalHours: number;
  fcmTokenStaleDeactivateDays: number;
  fcmTokenInactivePurgeDays: number;
  releaseMonitorWarnSendFailureRatio: number;
  releaseMonitorWarnInvalidTokenRatio: number;
  syncPushRateLimitMaxPerMinute: number;
  syncPullRateLimitMaxPerMinute: number;
  openaiApiKey: string;
  recommendationsSchedulerEnabled: boolean;
  recommendationsDailyStaleHours: number;
  recommendationsTopLimit: number;
  recommendationsSimilarityK: number;
  recommendationsEmbeddingModel: string;
  recommendationsEmbeddingDimensions: number;
  recommendationsEmbeddingBatchSize: number;
  recommendationsEmbeddingTimeoutMs: number;
  recommendationsSemanticWeight: number;
  recommendationsSimilarityStructuredWeight: number;
  recommendationsSimilaritySemanticWeight: number;
  recommendationsFailureBackoffMinutes: number;
  recommendationsRuntimeModeDefault: 'NEUTRAL' | 'SHORT' | 'LONG';
  recommendationsExplorationWeight: number;
  recommendationsDiversityPenaltyWeight: number;
  recommendationsRepeatPenaltyStep: number;
  recommendationsTuningMinRated: number;
  recommendationsLaneLimit: number;
  recommendationsKeywordsStructuredMax: number;
  recommendationsKeywordsEmbeddingMax: number;
  recommendationsKeywordsGlobalMaxRatio: number;
  recommendationsKeywordsStructuredMaxRatio: number;
  recommendationsKeywordsMinLibraryCount: number;
  recommendationsKeywordsWeight: number;
  recommendationsThemesWeight: number;
  recommendationsSimilarityThemeWeight: number;
  recommendationsSimilarityGenreWeight: number;
  recommendationsSimilaritySeriesWeight: number;
  recommendationsSimilarityDeveloperWeight: number;
  recommendationsSimilarityPublisherWeight: number;
  recommendationsSimilarityKeywordWeight: number;
  recommendationsDiscoveryEnabled: boolean;
  recommendationsDiscoveryPoolSize: number;
  recommendationsDiscoveryRefreshHours: number;
  recommendationsDiscoveryPopularRefreshHours: number;
  recommendationsDiscoveryRecentRefreshHours: number;
  recommendationsDiscoveryIgdbRequestTimeoutMs: number;
  recommendationsDiscoveryIgdbMaxRequestsPerSecond: number;
  recommendationsDiscoveryEnrichEnabled: boolean;
  recommendationsDiscoveryEnrichStartupDelayMs: number;
  recommendationsDiscoveryEnrichIntervalMinutes: number;
  recommendationsDiscoveryEnrichMaxGamesPerRun: number;
  recommendationsDiscoveryEnrichRequestTimeoutMs: number;
  recommendationsDiscoveryEnrichMaxAttempts: number;
  recommendationsDiscoveryEnrichBackoffBaseMinutes: number;
  recommendationsDiscoveryEnrichBackoffMaxHours: number;
  recommendationsDiscoveryEnrichRearmAfterDays: number;
  recommendationsDiscoveryEnrichRearmRecentReleaseYears: number;
  popularityIngestEnabled: boolean;
  popularityIngestIntervalMinutes: number;
  popularityIngestIgdbRequestTimeoutMs: number;
  popularityIngestIgdbMaxRequestsPerSecond: number;
  popularityFeedRowLimit: number;
  popularityScoreThreshold: number;
  igdbMetadataEnrichEnabled: boolean;
  igdbMetadataEnrichBatchSize: number;
  igdbMetadataEnrichMaxGamesPerRun: number;
  igdbMetadataEnrichStartupDelayMs: number;
  igdbMetadataEnrichRequestTimeoutMs: number;
}

function readTokenList(name: string, fallbackSecretName: string): string[] {
  const source = readSecretFile(name, fallbackSecretName);

  if (!source) {
    return [];
  }

  return [
    ...new Set(
      source
        .split(/[\r\n,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ];
}

function readPathEnv(name: string, fallbackAbsolutePath: string): string {
  const value = readEnv(name);

  if (!value) {
    return fallbackAbsolutePath;
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(serverRootDir, value);
}

function readListEnv(name: string, fallback: string[]): string[] {
  const raw = readEnv(name);
  const source = raw.length > 0 ? raw : fallback.join(',');
  return source
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function readRuntimeModeDefaultEnv(
  name: string,
  fallback: 'NEUTRAL' | 'SHORT' | 'LONG'
): 'NEUTRAL' | 'SHORT' | 'LONG' {
  const parsed = parseRecommendationRuntimeMode(readEnv(name));
  return parsed ?? fallback;
}

function normalizeCountryCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

const EMBEDDING_DIMENSIONS_SCHEMA = 1536;

function readEmbeddingDimensionsEnv(name: string): number {
  const value = readIntegerEnv(name, EMBEDDING_DIMENSIONS_SCHEMA);
  if (value !== EMBEDDING_DIMENSIONS_SCHEMA) {
    throw new Error(
      `${name} must be ${String(EMBEDDING_DIMENSIONS_SCHEMA)} to match game_embeddings schema`
    );
  }
  return value;
}

export const config: AppConfig = {
  host: readEnv('HOST', '0.0.0.0'),
  port: readIntegerEnv('PORT', 3000),
  requestBodyLimitBytes: readIntegerEnv('REQUEST_BODY_LIMIT_BYTES', 10 * 1024 * 1024),
  globalRateLimitMaxRequests: readIntegerEnv('GLOBAL_RATE_LIMIT_MAX_REQUESTS', 2000),
  globalRateLimitWindowMs: readIntegerEnv('GLOBAL_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  corsAllowedOrigins: readListEnv('CORS_ORIGIN', [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8100',
    'http://127.0.0.1:8100'
  ]),
  postgresUrl: readRequiredSecretFile('DATABASE_URL', 'database_url'),
  apiToken: readSecretFile('API_TOKEN', 'api_token'),
  clientWriteTokens: readTokenList('CLIENT_WRITE_TOKENS', 'client_write_tokens'),
  requireAuth: readBooleanEnv('REQUIRE_AUTH', true),
  imageCacheDir: readPathEnv('IMAGE_CACHE_DIR', path.resolve(serverRootDir, '.data/image-cache')),
  imageCacheTtlSeconds: readIntegerEnv('IMAGE_CACHE_TTL_SECONDS', 86400 * 30),
  imageProxyTimeoutMs: readIntegerEnv('IMAGE_PROXY_TIMEOUT_MS', 12_000),
  imageProxyMaxBytes: readIntegerEnv('IMAGE_PROXY_MAX_BYTES', 8 * 1024 * 1024),
  twitchClientId: readRequiredSecretFile('TWITCH_CLIENT_ID', 'twitch_client_id'),
  twitchClientSecret: readRequiredSecretFile('TWITCH_CLIENT_SECRET', 'twitch_client_secret'),
  theGamesDbApiKey: readRequiredSecretFile('THEGAMESDB_API_KEY', 'thegamesdb_api_key'),
  imageProxyRateLimitWindowMs: readIntegerEnv('IMAGE_PROXY_RATE_LIMIT_WINDOW_MS', 60_000),
  imageProxyMaxRequestsPerWindow: readIntegerEnv('IMAGE_PROXY_MAX_REQUESTS_PER_WINDOW', 120),
  imagePurgeMaxRequestsPerWindow: readIntegerEnv('IMAGE_PURGE_MAX_REQUESTS_PER_WINDOW', 30),
  cacheStatsRateLimitWindowMs: readIntegerEnv('CACHE_STATS_RATE_LIMIT_WINDOW_MS', 60_000),
  cacheStatsMaxRequestsPerWindow: readIntegerEnv('CACHE_STATS_MAX_REQUESTS_PER_WINDOW', 60),
  hltbScraperBaseUrl: readEnv('HLTB_SCRAPER_BASE_URL', ''),
  hltbScraperToken: readSecretFile('HLTB_SCRAPER_TOKEN', 'hltb_scraper_token'),
  hltbCacheEnableStaleWhileRevalidate: readBooleanEnv(
    'HLTB_CACHE_ENABLE_STALE_WHILE_REVALIDATE',
    true
  ),
  hltbCacheFreshTtlSeconds: readIntegerEnv('HLTB_CACHE_FRESH_TTL_SECONDS', 86400 * 7),
  hltbCacheStaleTtlSeconds: readIntegerEnv('HLTB_CACHE_STALE_TTL_SECONDS', 86400 * 90),
  hltbSearchRateLimitMaxPerMinute: readIntegerEnv('HLTB_SEARCH_RATE_LIMIT_MAX_PER_MINUTE', 240),
  metacriticScraperBaseUrl: readEnv('METACRITIC_SCRAPER_BASE_URL', ''),
  metacriticScraperToken: readSecretFile('METACRITIC_SCRAPER_TOKEN', 'metacritic_scraper_token'),
  metacriticCacheEnableStaleWhileRevalidate: readBooleanEnv(
    'METACRITIC_CACHE_ENABLE_STALE_WHILE_REVALIDATE',
    true
  ),
  metacriticCacheFreshTtlSeconds: readIntegerEnv('METACRITIC_CACHE_FRESH_TTL_SECONDS', 86400 * 7),
  metacriticCacheStaleTtlSeconds: readIntegerEnv('METACRITIC_CACHE_STALE_TTL_SECONDS', 86400 * 90),
  metacriticSearchRateLimitMaxPerMinute: readIntegerEnv(
    'METACRITIC_SEARCH_RATE_LIMIT_MAX_PER_MINUTE',
    240
  ),
  mobygamesApiBaseUrl: readEnv('MOBYGAMES_API_BASE_URL', 'https://api.mobygames.com/v2'),
  mobygamesApiKey: readSecretFile('MOBYGAMES_API_KEY', 'mobygames_api_key'),
  steamStoreApiBaseUrl: readEnv('STEAM_STORE_API_BASE_URL', 'https://store.steampowered.com'),
  steamStoreApiTimeoutMs: readIntegerEnv('STEAM_STORE_API_TIMEOUT_MS', 10_000),
  steamDefaultCountry: normalizeCountryCode(readEnv('STEAM_DEFAULT_COUNTRY', 'CH')) ?? 'CH',
  steamPriceCacheEnableStaleWhileRevalidate: readBooleanEnv(
    'STEAM_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE',
    true
  ),
  steamPriceCacheFreshTtlSeconds: readIntegerEnv('STEAM_PRICE_CACHE_FRESH_TTL_SECONDS', 86400),
  steamPriceCacheStaleTtlSeconds: readIntegerEnv('STEAM_PRICE_CACHE_STALE_TTL_SECONDS', 86400 * 90),
  pspricesScraperBaseUrl: readEnv('PSPRICES_SCRAPER_BASE_URL', 'http://psprices-scraper:8790'),
  pspricesScraperToken: readSecretFile('PSPRICES_SCRAPER_TOKEN', 'psprices_scraper_token'),
  pspricesRegionPath: readEnv('PSPRICES_REGION_PATH', 'region-ch'),
  pspricesShow: readEnv('PSPRICES_SHOW', 'games'),
  pspricesPriceCacheEnableStaleWhileRevalidate: readBooleanEnv(
    'PSPRICES_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE',
    true
  ),
  pspricesPriceCacheFreshTtlSeconds: readIntegerEnv(
    'PSPRICES_PRICE_CACHE_FRESH_TTL_SECONDS',
    86400
  ),
  pspricesPriceCacheStaleTtlSeconds: readIntegerEnv(
    'PSPRICES_PRICE_CACHE_STALE_TTL_SECONDS',
    86400 * 90
  ),
  pricingRefreshEnabled: readBooleanEnv('PRICING_REFRESH_ENABLED', true),
  pricingRefreshIntervalMinutes: readIntegerEnv('PRICING_REFRESH_INTERVAL_MINUTES', 60),
  pricingRefreshBatchSize: readIntegerEnv('PRICING_REFRESH_BATCH_SIZE', 200),
  pricingRefreshStaleHours: readIntegerEnv('PRICING_REFRESH_STALE_HOURS', 24),
  discoveryPricingRefreshEnabled: readBooleanEnv('DISCOVERY_PRICING_REFRESH_ENABLED', true),
  discoveryPricingRefreshIntervalMinutes: readIntegerEnv(
    'DISCOVERY_PRICING_REFRESH_INTERVAL_MINUTES',
    60
  ),
  discoveryPricingRefreshBatchSize: readIntegerEnv('DISCOVERY_PRICING_REFRESH_BATCH_SIZE', 200),
  discoveryPricingRefreshStaleHours: readIntegerEnv('DISCOVERY_PRICING_REFRESH_STALE_HOURS', 24),
  mobygamesCacheEnableStaleWhileRevalidate: readBooleanEnv(
    'MOBYGAMES_CACHE_ENABLE_STALE_WHILE_REVALIDATE',
    true
  ),
  mobygamesCacheFreshTtlSeconds: readIntegerEnv('MOBYGAMES_CACHE_FRESH_TTL_SECONDS', 86400 * 7),
  mobygamesCacheStaleTtlSeconds: readIntegerEnv('MOBYGAMES_CACHE_STALE_TTL_SECONDS', 86400 * 90),
  mobygamesSearchRateLimitMaxPerMinute: readIntegerEnv(
    'MOBYGAMES_SEARCH_RATE_LIMIT_MAX_PER_MINUTE',
    12
  ),
  manualsDir: readPathEnv('MANUALS_DIR', path.resolve(serverRootDir, '../nas-data/manuals')),
  firebaseServiceAccountJson: readSecretFile(
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'firebase_service_account_json'
  ),
  notificationsTestEndpointEnabled: readBooleanEnv('NOTIFICATIONS_TEST_ENDPOINT_ENABLED', false),
  notificationsObservabilityEndpointEnabled: readBooleanEnv(
    'NOTIFICATIONS_OBSERVABILITY_ENDPOINT_ENABLED',
    false
  ),
  releaseMonitorEnabled: readBooleanEnv('RELEASE_MONITOR_ENABLED', true),
  releaseMonitorIntervalSeconds: readIntegerEnv('RELEASE_MONITOR_INTERVAL_SECONDS', 900),
  releaseMonitorBatchSize: readIntegerEnv('RELEASE_MONITOR_BATCH_SIZE', 100),
  releaseMonitorDebugLogs: readBooleanEnv('RELEASE_MONITOR_DEBUG_LOGS', false),
  hltbPeriodicRefreshYears: readIntegerEnv('HLTB_PERIODIC_REFRESH_YEARS', 3),
  hltbPeriodicRefreshDays: readIntegerEnv('HLTB_PERIODIC_REFRESH_DAYS', 30),
  metacriticPeriodicRefreshYears: readIntegerEnv('METACRITIC_PERIODIC_REFRESH_YEARS', 3),
  metacriticPeriodicRefreshDays: readIntegerEnv('METACRITIC_PERIODIC_REFRESH_DAYS', 30),
  fcmTokenCleanupEnabled: readBooleanEnv('FCM_TOKEN_CLEANUP_ENABLED', true),
  fcmTokenCleanupIntervalHours: readIntegerEnv('FCM_TOKEN_CLEANUP_INTERVAL_HOURS', 24),
  fcmTokenStaleDeactivateDays: readIntegerEnv('FCM_TOKEN_STALE_DEACTIVATE_DAYS', 60),
  fcmTokenInactivePurgeDays: readIntegerEnv('FCM_TOKEN_INACTIVE_PURGE_DAYS', 180),
  releaseMonitorWarnSendFailureRatio: readNumberEnv('RELEASE_MONITOR_WARN_SEND_FAILURE_RATIO', 0.5),
  releaseMonitorWarnInvalidTokenRatio: readNumberEnv(
    'RELEASE_MONITOR_WARN_INVALID_TOKEN_RATIO',
    0.2
  ),
  manualsPublicBaseUrl: readEnv('MANUALS_PUBLIC_BASE_URL', '/manuals'),
  syncPushRateLimitMaxPerMinute: readIntegerEnv('SYNC_PUSH_RATE_LIMIT_MAX_PER_MINUTE', 120),
  syncPullRateLimitMaxPerMinute: readIntegerEnv('SYNC_PULL_RATE_LIMIT_MAX_PER_MINUTE', 120),
  openaiApiKey: readSecretFile('OPENAI_API_KEY', 'openai_api_key'),
  recommendationsSchedulerEnabled: readBooleanEnv('RECOMMENDATIONS_SCHEDULER_ENABLED', true),
  recommendationsDailyStaleHours: readIntegerEnv('RECOMMENDATIONS_DAILY_STALE_HOURS', 24),
  recommendationsTopLimit: readIntegerEnv('RECOMMENDATIONS_TOP_LIMIT', 200),
  recommendationsSimilarityK: readIntegerEnv('RECOMMENDATIONS_SIMILARITY_K', 20),
  recommendationsEmbeddingModel: readEnv(
    'RECOMMENDATIONS_EMBEDDING_MODEL',
    'text-embedding-3-small'
  ),
  recommendationsEmbeddingDimensions: readEmbeddingDimensionsEnv(
    'RECOMMENDATIONS_EMBEDDING_DIMENSIONS'
  ),
  recommendationsEmbeddingBatchSize: readIntegerEnv('RECOMMENDATIONS_EMBEDDING_BATCH_SIZE', 32),
  recommendationsEmbeddingTimeoutMs: readIntegerEnv('RECOMMENDATIONS_EMBEDDING_TIMEOUT_MS', 15000),
  recommendationsSemanticWeight: readNumberEnv('RECOMMENDATIONS_SEMANTIC_WEIGHT', 2),
  recommendationsSimilarityStructuredWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_STRUCTURED_WEIGHT',
    0.6
  ),
  recommendationsSimilaritySemanticWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_SEMANTIC_WEIGHT',
    0.4
  ),
  recommendationsFailureBackoffMinutes: readIntegerEnv(
    'RECOMMENDATIONS_FAILURE_BACKOFF_MINUTES',
    120
  ),
  recommendationsRuntimeModeDefault: readRuntimeModeDefaultEnv(
    'RECOMMENDATIONS_RUNTIME_MODE_DEFAULT',
    'NEUTRAL'
  ),
  recommendationsExplorationWeight: readNumberEnv('RECOMMENDATIONS_EXPLORATION_WEIGHT', 0.3),
  recommendationsDiversityPenaltyWeight: readNumberEnv(
    'RECOMMENDATIONS_DIVERSITY_PENALTY_WEIGHT',
    0.5
  ),
  recommendationsRepeatPenaltyStep: readNumberEnv('RECOMMENDATIONS_REPEAT_PENALTY_STEP', 0.2),
  recommendationsTuningMinRated: readIntegerEnv('RECOMMENDATIONS_TUNING_MIN_RATED', 8),
  recommendationsLaneLimit: readIntegerEnv('RECOMMENDATIONS_LANE_LIMIT', 20),
  recommendationsKeywordsStructuredMax: readIntegerEnv(
    'RECOMMENDATIONS_KEYWORDS_STRUCTURED_MAX',
    100
  ),
  recommendationsKeywordsEmbeddingMax: readIntegerEnv('RECOMMENDATIONS_KEYWORDS_EMBEDDING_MAX', 40),
  recommendationsKeywordsGlobalMaxRatio: readNumberEnv(
    'RECOMMENDATIONS_KEYWORDS_GLOBAL_MAX_RATIO',
    0.7
  ),
  recommendationsKeywordsStructuredMaxRatio: readNumberEnv(
    'RECOMMENDATIONS_KEYWORDS_STRUCTURED_MAX_RATIO',
    0.3
  ),
  recommendationsKeywordsMinLibraryCount: readIntegerEnv(
    'RECOMMENDATIONS_KEYWORDS_MIN_LIBRARY_COUNT',
    3
  ),
  recommendationsKeywordsWeight: readNumberEnv('RECOMMENDATIONS_KEYWORDS_WEIGHT', 0.6),
  recommendationsThemesWeight: readNumberEnv('RECOMMENDATIONS_THEMES_WEIGHT', 1.3),
  recommendationsSimilarityThemeWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_THEME_WEIGHT',
    0.35
  ),
  recommendationsSimilarityGenreWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_GENRE_WEIGHT',
    0.25
  ),
  recommendationsSimilaritySeriesWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_SERIES_WEIGHT',
    0.2
  ),
  recommendationsSimilarityDeveloperWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_DEVELOPER_WEIGHT',
    0.1
  ),
  recommendationsSimilarityPublisherWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_PUBLISHER_WEIGHT',
    0.1
  ),
  recommendationsSimilarityKeywordWeight: readNumberEnv(
    'RECOMMENDATIONS_SIMILARITY_KEYWORD_WEIGHT',
    0.05
  ),
  recommendationsDiscoveryEnabled: readBooleanEnv('RECOMMENDATIONS_DISCOVERY_ENABLED', true),
  recommendationsDiscoveryPoolSize: readIntegerEnv('RECOMMENDATIONS_DISCOVERY_POOL_SIZE', 2000),
  recommendationsDiscoveryRefreshHours: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_REFRESH_HOURS',
    24
  ),
  recommendationsDiscoveryPopularRefreshHours: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_POPULAR_REFRESH_HOURS',
    readIntegerEnv('RECOMMENDATIONS_DISCOVERY_REFRESH_HOURS', 24)
  ),
  recommendationsDiscoveryRecentRefreshHours: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_RECENT_REFRESH_HOURS',
    Math.min(6, readIntegerEnv('RECOMMENDATIONS_DISCOVERY_REFRESH_HOURS', 24))
  ),
  recommendationsDiscoveryIgdbRequestTimeoutMs: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_IGDB_REQUEST_TIMEOUT_MS',
    15_000
  ),
  recommendationsDiscoveryIgdbMaxRequestsPerSecond: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_IGDB_MAX_REQUESTS_PER_SECOND',
    4
  ),
  recommendationsDiscoveryEnrichEnabled: readBooleanEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_ENABLED',
    true
  ),
  recommendationsDiscoveryEnrichStartupDelayMs: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_STARTUP_DELAY_MS',
    5000
  ),
  recommendationsDiscoveryEnrichIntervalMinutes: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_INTERVAL_MINUTES',
    30
  ),
  recommendationsDiscoveryEnrichMaxGamesPerRun: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_MAX_GAMES_PER_RUN',
    500
  ),
  recommendationsDiscoveryEnrichRequestTimeoutMs: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_REQUEST_TIMEOUT_MS',
    15_000
  ),
  recommendationsDiscoveryEnrichMaxAttempts: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_MAX_ATTEMPTS',
    6
  ),
  recommendationsDiscoveryEnrichBackoffBaseMinutes: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_BACKOFF_BASE_MINUTES',
    60
  ),
  recommendationsDiscoveryEnrichBackoffMaxHours: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_BACKOFF_MAX_HOURS',
    168
  ),
  recommendationsDiscoveryEnrichRearmAfterDays: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_AFTER_DAYS',
    DISCOVERY_ENRICHMENT_REARM_AFTER_DAYS_DEFAULT
  ),
  recommendationsDiscoveryEnrichRearmRecentReleaseYears: readIntegerEnv(
    'RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_RECENT_RELEASE_YEARS',
    DISCOVERY_ENRICHMENT_REARM_RECENT_RELEASE_YEARS_DEFAULT
  ),
  popularityIngestEnabled: readBooleanEnv('POPULARITY_INGEST_ENABLED', true),
  popularityIngestIntervalMinutes: readIntegerEnv('POPULARITY_INGEST_INTERVAL_MINUTES', 30),
  popularityIngestIgdbRequestTimeoutMs: readIntegerEnv(
    'POPULARITY_INGEST_IGDB_REQUEST_TIMEOUT_MS',
    readIntegerEnv('RECOMMENDATIONS_DISCOVERY_IGDB_REQUEST_TIMEOUT_MS', 15_000)
  ),
  popularityIngestIgdbMaxRequestsPerSecond: readIntegerEnv(
    'POPULARITY_INGEST_IGDB_MAX_REQUESTS_PER_SECOND',
    readIntegerEnv('RECOMMENDATIONS_DISCOVERY_IGDB_MAX_REQUESTS_PER_SECOND', 4)
  ),
  popularityFeedRowLimit: readIntegerEnv('POPULARITY_FEED_ROW_LIMIT', 50),
  popularityScoreThreshold: readNumberEnv('POPULARITY_SCORE_THRESHOLD', 50),
  igdbMetadataEnrichEnabled: readBooleanEnv('IGDB_METADATA_ENRICH_ENABLED', true),
  igdbMetadataEnrichBatchSize: readIntegerEnv('IGDB_METADATA_ENRICH_BATCH_SIZE', 200),
  igdbMetadataEnrichMaxGamesPerRun: readIntegerEnv('IGDB_METADATA_ENRICH_MAX_GAMES_PER_RUN', 5000),
  igdbMetadataEnrichStartupDelayMs: readIntegerEnv('IGDB_METADATA_ENRICH_STARTUP_DELAY_MS', 5000),
  igdbMetadataEnrichRequestTimeoutMs: readIntegerEnv(
    'IGDB_METADATA_ENRICH_REQUEST_TIMEOUT_MS',
    15_000
  )
};
