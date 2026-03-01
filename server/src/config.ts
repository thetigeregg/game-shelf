import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

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
    if (readEnv('NODE_ENV') === 'test') {
      return `test_${name.toLowerCase()}`;
    }
    throw new Error(`Missing required secret file for ${name} (${name}_FILE)`);
  }
  return value;
}

function readIntegerEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  mobygamesCacheEnableStaleWhileRevalidate: boolean;
  mobygamesCacheFreshTtlSeconds: number;
  mobygamesCacheStaleTtlSeconds: number;
  mobygamesSearchRateLimitMaxPerMinute: number;
  manualsDir: string;
  manualsPublicBaseUrl: string;
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

export const config: AppConfig = {
  host: readEnv('HOST', '0.0.0.0'),
  port: readIntegerEnv('PORT', 3000),
  requestBodyLimitBytes: readIntegerEnv('REQUEST_BODY_LIMIT_BYTES', 10 * 1024 * 1024),
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
  manualsPublicBaseUrl: readEnv('MANUALS_PUBLIC_BASE_URL', '/manuals')
};
