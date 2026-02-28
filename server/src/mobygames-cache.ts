import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool } from 'pg';
import { incrementMobygamesMetric } from './cache-metrics.js';
import { config } from './config.js';
import {
  isDebugHttpLogsEnabled,
  logUpstreamRequest,
  logUpstreamResponse,
  sanitizeUrlForDebugLogs
} from './http-debug-log.js';

interface MobyGamesCacheRow {
  response_json: unknown;
  updated_at: string;
}

interface NormalizedMobyGamesQuery {
  query: string;
  platform: string | null;
  limit: number | null;
  offset: number | null;
  id: string | null;
  genre: string | null;
  group: string | null;
  format: 'id' | 'brief' | 'normal' | null;
  include: string | null;
}

interface MobyGamesCacheRouteOptions {
  fetchMetadata?: (request: FastifyRequest) => Promise<Response>;
  now?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

const DEFAULT_MOBYGAMES_CACHE_FRESH_TTL_SECONDS = 86400 * 7;
const DEFAULT_MOBYGAMES_CACHE_STALE_TTL_SECONDS = 86400 * 90;
const revalidationInFlightByKey = new Map<string, Promise<void>>();

export async function registerMobyGamesCachedRoute(
  app: FastifyInstance,
  pool: Pool,
  options: MobyGamesCacheRouteOptions = {}
): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, { global: false });
  }
  const fetchMetadata = options.fetchMetadata ?? fetchMetadataFromMobyGames;
  const now = options.now ?? (() => Date.now());
  const scheduleBackgroundRefresh =
    options.scheduleBackgroundRefresh ??
    ((task) => {
      queueMicrotask(() => {
        void task();
      });
    });
  const enableStaleWhileRevalidate = options.enableStaleWhileRevalidate ?? true;
  const freshTtlSeconds = normalizeTtlSeconds(
    options.freshTtlSeconds,
    DEFAULT_MOBYGAMES_CACHE_FRESH_TTL_SECONDS
  );
  const staleTtlSeconds = Math.max(
    freshTtlSeconds,
    normalizeTtlSeconds(options.staleTtlSeconds, DEFAULT_MOBYGAMES_CACHE_STALE_TTL_SECONDS)
  );

  app.route({
    method: 'GET',
    url: '/v1/mobygames/search',
    config: {
      rateLimit: {
        max: config.mobygamesSearchRateLimitMaxPerMinute,
        timeWindow: '1 minute'
      }
    },
    handler: async (request, reply) => {
      const normalized = normalizeMobyGamesQuery(request.url);
      const cacheKey = normalized ? buildCacheKey(normalized) : null;
      let cacheOutcome: 'MISS' | 'BYPASS' = 'MISS';

      if (cacheKey) {
        try {
          const cached = await pool.query<MobyGamesCacheRow>(
            'SELECT response_json, updated_at FROM mobygames_search_cache WHERE cache_key = $1 LIMIT 1',
            [cacheKey]
          );
          const cachedRow = cached.rows[0] as MobyGamesCacheRow | undefined;

          if (cachedRow) {
            if (!isCacheableMobyGamesPayload(cachedRow.response_json)) {
              await deleteMobyGamesCacheEntry(pool, cacheKey, request);
            } else {
              const ageSeconds = getAgeSeconds(cachedRow.updated_at, now());

              if (ageSeconds <= freshTtlSeconds) {
                incrementMobygamesMetric('hits');
                logMobygamesCacheDecision(
                  request,
                  'HIT_FRESH',
                  normalized,
                  cachedRow.response_json
                );
                reply.header('X-GameShelf-MOBYGAMES-Cache', 'HIT_FRESH');
                reply.code(200).send(cachedRow.response_json);
                return;
              }

              if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds) {
                incrementMobygamesMetric('hits');
                incrementMobygamesMetric('staleServed');
                const scheduled = scheduleMobyGamesRevalidation(
                  cacheKey,
                  request,
                  normalized,
                  fetchMetadata,
                  pool,
                  scheduleBackgroundRefresh
                );
                logMobygamesCacheDecision(
                  request,
                  'HIT_STALE',
                  normalized,
                  cachedRow.response_json,
                  {
                    revalidateScheduled: scheduled
                  }
                );
                reply.header('X-GameShelf-MOBYGAMES-Cache', 'HIT_STALE');
                reply.header(
                  'X-GameShelf-MOBYGAMES-Revalidate',
                  scheduled ? 'scheduled' : 'skipped'
                );
                reply.code(200).send(cachedRow.response_json);
                return;
              }
            }
          }
        } catch (error) {
          incrementMobygamesMetric('readErrors');
          incrementMobygamesMetric('bypasses');
          cacheOutcome = 'BYPASS';
          request.log.warn({
            msg: 'mobygames_cache_read_failed',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      incrementMobygamesMetric('misses');
      if (!normalized) {
        logMobygamesCacheDecision(request, 'BYPASS', null, null, {
          reason: 'query_too_short'
        });
      } else {
        logMobygamesCacheDecision(request, 'MISS', normalized, null);
      }
      const response = await fetchMetadata(request);

      if (cacheKey && normalized && response.ok) {
        const payload = await safeReadJson(response);

        if (payload !== null && isCacheableMobyGamesPayload(payload)) {
          await persistMobyGamesCacheEntry(pool, cacheKey, normalized, payload, request);
        }
      }

      reply.header('X-GameShelf-MOBYGAMES-Cache', cacheOutcome);
      await sendWebResponse(reply, response);
    }
  });
}

function logMobygamesCacheDecision(
  request: FastifyRequest,
  outcome: 'HIT_FRESH' | 'HIT_STALE' | 'MISS' | 'BYPASS',
  normalized: NormalizedMobyGamesQuery | null,
  payload: unknown,
  extra: Record<string, unknown> = {}
): void {
  if (!isDebugHttpLogsEnabled()) {
    return;
  }

  request.log.info({
    msg: 'mobygames_cache_decision',
    outcome,
    query: normalized?.query ?? null,
    platform: normalized?.platform ?? null,
    limit: normalized?.limit ?? null,
    offset: normalized?.offset ?? null,
    id: normalized?.id ?? null,
    format: normalized?.format ?? null,
    include: normalized?.include ?? null,
    ...describeMobygamesPayload(payload),
    ...extra
  });
}

function describeMobygamesPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') {
    return {
      gameCount: null,
      firstTitle: null
    };
  }

  const payloadRecord = payload as Record<string, unknown>;
  const games = Array.isArray(payloadRecord['games']) ? (payloadRecord['games'] as unknown[]) : [];

  let firstTitle: string | null = null;
  if (games.length > 0 && games[0] && typeof games[0] === 'object') {
    const firstRecord = games[0] as Record<string, unknown>;
    firstTitle = typeof firstRecord['title'] === 'string' ? firstRecord['title'] : null;
  }

  return {
    gameCount: games.length,
    firstTitle
  };
}

function normalizeMobyGamesQuery(rawUrl: string): NormalizedMobyGamesQuery | null {
  const url = new URL(rawUrl, 'http://game-shelf.local');
  const query = (url.searchParams.get('q') ?? url.searchParams.get('title') ?? '').trim();

  if (query.length < 2) {
    return null;
  }

  const platform = normalizeNullableString(url.searchParams.get('platform'));
  const platformId = normalizeInteger(platform, 1);
  const limit = normalizeInteger(url.searchParams.get('limit'), 1);
  const offset = normalizeInteger(url.searchParams.get('offset'), 0);
  const idValue = normalizeInteger(url.searchParams.get('id'), 1);
  const genreValue = normalizeInteger(url.searchParams.get('genre'), 1);
  const groupValue = normalizeInteger(url.searchParams.get('group'), 1);
  const format = normalizeMobyGamesFormat(url.searchParams.get('format'));
  const include = normalizeMobyGamesInclude(url.searchParams.get('include'));

  return {
    query,
    platform: platformId === null ? null : String(platformId),
    limit,
    offset,
    id: idValue === null ? null : String(idValue),
    genre: genreValue === null ? null : String(genreValue),
    group: groupValue === null ? null : String(groupValue),
    format,
    include
  };
}

function normalizeNullableString(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeInteger(rawValue: string | null, minimum: number): number | null {
  const trimmed = (rawValue ?? '').trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : null;
}

function normalizeMobyGamesFormat(rawValue: string | null): 'id' | 'brief' | 'normal' | null {
  const trimmed = (rawValue ?? '').trim().toLowerCase();
  if (trimmed === 'id' || trimmed === 'brief' || trimmed === 'normal') {
    return trimmed;
  }
  return null;
}

function normalizeMobyGamesInclude(rawValue: string | null): string | null {
  const normalized = (rawValue ?? '').trim();
  if (normalized.length === 0) {
    return null;
  }

  const fields = normalized
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^[a-z0-9_.]+$/i.test(value));
  if (fields.length === 0) {
    return null;
  }

  return [...new Set(fields)].join(',');
}

function buildCacheKey(query: NormalizedMobyGamesQuery): string {
  const payload = JSON.stringify([
    query.query.toLowerCase(),
    query.platform?.toLowerCase() ?? null,
    query.limit,
    query.offset,
    query.id?.toLowerCase() ?? null,
    query.genre?.toLowerCase() ?? null,
    query.group?.toLowerCase() ?? null,
    query.format,
    query.include?.toLowerCase() ?? null
  ]);

  return crypto.createHash('sha256').update(payload).digest('hex');
}

function normalizeTtlSeconds(input: number | undefined, fallback: number): number {
  return Number.isInteger(input) && (input as number) > 0 ? (input as number) : fallback;
}

function getAgeSeconds(updatedAt: string, nowMs: number): number {
  const updatedMs = Date.parse(updatedAt);

  if (!Number.isFinite(updatedMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (nowMs - updatedMs) / 1000);
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function scheduleMobyGamesRevalidation(
  cacheKey: string,
  request: FastifyRequest,
  normalizedQuery: NormalizedMobyGamesQuery,
  fetchMetadata: (request: FastifyRequest) => Promise<Response>,
  pool: Pool,
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void
): boolean {
  if (revalidationInFlightByKey.has(cacheKey)) {
    incrementMobygamesMetric('revalidateSkipped');
    return false;
  }

  incrementMobygamesMetric('revalidateScheduled');

  let resolveDone: (() => void) | null = null;
  const inFlight = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  revalidationInFlightByKey.set(cacheKey, inFlight);

  scheduleBackgroundRefresh(async () => {
    try {
      const response = await fetchMetadata(request);

      if (!response.ok) {
        incrementMobygamesMetric('revalidateFailed');
        return;
      }

      const payload = await safeReadJson(response);

      if (payload === null) {
        incrementMobygamesMetric('revalidateFailed');
        return;
      }

      if (!isCacheableMobyGamesPayload(payload)) {
        incrementMobygamesMetric('revalidateFailed');
        return;
      }

      await persistMobyGamesCacheEntry(pool, cacheKey, normalizedQuery, payload, request);
      incrementMobygamesMetric('revalidateSucceeded');
    } catch (error) {
      incrementMobygamesMetric('revalidateFailed');
      request.log.warn({
        msg: 'mobygames_cache_revalidate_failed',
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      revalidationInFlightByKey.delete(cacheKey);
      resolveDone?.();
    }
  });

  return true;
}

async function persistMobyGamesCacheEntry(
  pool: Pool,
  cacheKey: string,
  normalizedQuery: NormalizedMobyGamesQuery,
  payload: unknown,
  request: FastifyRequest
): Promise<void> {
  try {
    await pool.query(
      `
      INSERT INTO mobygames_search_cache (cache_key, query_title, platform, response_json, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW())
      ON CONFLICT (cache_key)
      DO UPDATE SET
        response_json = EXCLUDED.response_json,
        updated_at = NOW()
      `,
      [cacheKey, normalizedQuery.query, normalizedQuery.platform, JSON.stringify(payload)]
    );
    incrementMobygamesMetric('writes');
  } catch (error) {
    incrementMobygamesMetric('writeErrors');
    request.log.warn({
      msg: 'mobygames_cache_write_failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function isCacheableMobyGamesPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const payloadRecord = payload as Record<string, unknown>;
  return Array.isArray(payloadRecord['games']) && payloadRecord['games'].length > 0;
}

async function deleteMobyGamesCacheEntry(
  pool: Pool,
  cacheKey: string,
  request: FastifyRequest
): Promise<void> {
  try {
    await pool.query('DELETE FROM mobygames_search_cache WHERE cache_key = $1', [cacheKey]);
  } catch (error) {
    incrementMobygamesMetric('writeErrors');
    request.log.warn({
      msg: 'mobygames_cache_delete_failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function fetchMetadataFromMobyGames(request: FastifyRequest): Promise<Response> {
  const baseUrl = (readEnv('MOBYGAMES_API_BASE_URL').trim() || config.mobygamesApiBaseUrl).trim();
  const apiKey = (
    readSecretFile('MOBYGAMES_API_KEY', 'mobygames_api_key').trim() || config.mobygamesApiKey
  ).trim();

  if (!baseUrl) {
    return new Response(JSON.stringify({ error: 'MobyGames API base URL is not configured' }), {
      status: 503,
      headers: {
        'content-type': 'application/json'
      }
    });
  }

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'MobyGames API key is not configured' }), {
      status: 503,
      headers: {
        'content-type': 'application/json'
      }
    });
  }

  const normalized = normalizeMobyGamesQuery(request.url);

  if (!normalized) {
    return new Response(JSON.stringify({ games: [] }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    });
  }

  const targetUrl = buildMobyGamesGamesUrl(baseUrl);
  targetUrl.searchParams.set('api_key', apiKey);
  targetUrl.searchParams.set('title', normalized.query);
  appendNullableString(targetUrl, 'platform', normalized.platform);
  appendNullableNumber(targetUrl, 'limit', normalized.limit);
  appendNullableNumber(targetUrl, 'offset', normalized.offset);
  appendNullableString(targetUrl, 'id', normalized.id);
  appendNullableString(targetUrl, 'genre', normalized.genre);
  appendNullableString(targetUrl, 'group', normalized.group);
  appendNullableString(targetUrl, 'format', normalized.format);
  appendNullableString(targetUrl, 'include', normalized.include);

  try {
    logUpstreamRequest(request, {
      method: 'GET',
      url: targetUrl.toString()
    });
    const response = await fetch(targetUrl.toString(), {
      method: 'GET'
    });
    await logUpstreamResponse(request, {
      method: 'GET',
      url: targetUrl.toString(),
      response
    });
    return response;
  } catch (error) {
    request.log.warn({
      msg: 'mobygames_request_failed',
      url: sanitizeUrlForDebugLogs(targetUrl.toString()),
      error: error instanceof Error ? error.message : String(error)
    });

    return new Response(JSON.stringify({ error: 'MobyGames request failed' }), {
      status: 502,
      headers: {
        'content-type': 'application/json'
      }
    });
  }
}

function appendNullableString(targetUrl: URL, key: string, value: string | null): void {
  if (value !== null) {
    targetUrl.searchParams.set(key, value);
  }
}

function appendNullableNumber(targetUrl: URL, key: string, value: number | null): void {
  if (value !== null) {
    targetUrl.searchParams.set(key, String(value));
  }
}

function buildMobyGamesGamesUrl(baseUrl: string): URL {
  const targetUrl = new URL(baseUrl);
  const normalizedPath = targetUrl.pathname.endsWith('/')
    ? targetUrl.pathname
    : `${targetUrl.pathname}/`;
  targetUrl.pathname = `${normalizedPath}games`;
  targetUrl.search = '';
  targetUrl.hash = '';
  return targetUrl;
}

function readEnv(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value : '';
}

function readSecretFile(name: string, fallbackSecretName: string): string {
  const explicit = readEnv(`${name}_FILE`).trim();
  const filePath = explicit.length > 0 ? explicit : `/run/secrets/${fallbackSecretName}`;
  if (!fs.existsSync(filePath)) {
    return '';
  }
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

async function sendWebResponse(reply: FastifyReply, response: Response): Promise<void> {
  reply.code(response.status);
  const skippedHeaders = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
  response.headers.forEach((value, key) => {
    if (skippedHeaders.has(key.toLowerCase())) {
      return;
    }
    reply.header(key, value);
  });

  if (!response.body) {
    reply.send();
    return;
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json') || contentType.startsWith('text/')) {
    const text = await response.text();
    reply.send(text);
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  reply.send(bytes);
}

export const __mobygamesCacheTestables = {
  normalizeMobyGamesQuery,
  getAgeSeconds,
  isCacheableMobyGamesPayload
};
