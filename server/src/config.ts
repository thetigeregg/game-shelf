import path from 'node:path';
import dotenv from 'dotenv';

const envFile = readEnvFilePath();
dotenv.config({ path: envFile });

function readEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : fallback;
}

function readRequiredEnv(name: string): string {
  const value = readEnv(name);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readIntegerEnv(name: string, fallback: number): number {
  const raw = readEnv(name);
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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
  corsOrigin: string;
  postgresUrl: string;
  imageCacheDir: string;
  imageCacheTtlSeconds: number;
  twitchClientId: string;
  twitchClientSecret: string;
  theGamesDbApiKey: string;
  hltbScraperBaseUrl: string;
  hltbScraperToken: string;
}

function readPathEnv(name: string, fallbackAbsolutePath: string): string {
  const value = readEnv(name);

  if (!value) {
    return fallbackAbsolutePath;
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(process.cwd(), value);
}

export const config: AppConfig = {
  host: readEnv('HOST', '0.0.0.0'),
  port: readIntegerEnv('PORT', 3000),
  corsOrigin: readEnv('CORS_ORIGIN', '*'),
  postgresUrl: readRequiredEnv('DATABASE_URL'),
  imageCacheDir: readPathEnv('IMAGE_CACHE_DIR', path.resolve(process.cwd(), '.data/image-cache')),
  imageCacheTtlSeconds: readIntegerEnv('IMAGE_CACHE_TTL_SECONDS', 86400 * 30),
  twitchClientId: readRequiredEnv('TWITCH_CLIENT_ID'),
  twitchClientSecret: readRequiredEnv('TWITCH_CLIENT_SECRET'),
  theGamesDbApiKey: readRequiredEnv('THEGAMESDB_API_KEY'),
  hltbScraperBaseUrl: readEnv('HLTB_SCRAPER_BASE_URL', ''),
  hltbScraperToken: readEnv('HLTB_SCRAPER_TOKEN', ''),
};
