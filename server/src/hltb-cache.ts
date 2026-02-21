import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { incrementHltbMetric } from './cache-metrics.js';
import { ensureRouteRateLimitRegistered } from './rate-limit.js';

interface HltbCacheRow {
  response_json: unknown;
  updated_at: string;
}

interface NormalizedHltbQuery {
  query: string;
  releaseYear: number | null;
  platform: string | null;
  includeCandidates: boolean;
}

interface HltbCacheRouteOptions {
  fetchMetadata?: (request: FastifyRequest) => Promise<Response>;
  now?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

const DEFAULT_HLTB_CACHE_FRESH_TTL_SECONDS = 86400 * 7;
const DEFAULT_HLTB_CACHE_STALE_TTL_SECONDS = 86400 * 90;
const revalidationInFlightByKey = new Map<string, Promise<void>>();

export async function registerHltbCachedRoute(
  app: FastifyInstance,
  pool: Pool,
  options: HltbCacheRouteOptions = {}
): Promise<void> {
  await ensureRouteRateLimitRegistered(app);
  const fetchMetadata = options.fetchMetadata ?? fetchMetadataFromWorker;
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
    DEFAULT_HLTB_CACHE_FRESH_TTL_SECONDS
  );
  const staleTtlSeconds = Math.max(
    freshTtlSeconds,
    normalizeTtlSeconds(options.staleTtlSeconds, DEFAULT_HLTB_CACHE_STALE_TTL_SECONDS)
  );

  app.get(
    '/v1/hltb/search',
    {
      config: {
        rateLimit: {
          max: 50,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const normalized = normalizeHltbQuery(request.url);
      const cacheKey = normalized ? buildCacheKey(normalized) : null;
      let cacheOutcome: 'MISS' | 'BYPASS' = 'MISS';

      if (cacheKey) {
        try {
          const cached = await pool.query<HltbCacheRow>(
            'SELECT response_json, updated_at FROM hltb_search_cache WHERE cache_key = $1 LIMIT 1',
            [cacheKey]
          );
          const cachedRow = cached.rows[0];

          if (cachedRow && normalized) {
            if (!isCacheableHltbPayload(normalized, cachedRow.response_json)) {
              await deleteHltbCacheEntry(pool, cacheKey, request);
            } else {
              const ageSeconds = getAgeSeconds(cachedRow.updated_at, now());

              if (ageSeconds <= freshTtlSeconds) {
                incrementHltbMetric('hits');
                reply.header('X-GameShelf-HLTB-Cache', 'HIT_FRESH');
                reply.code(200).send(cachedRow.response_json);
                return;
              }

              if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds && normalized) {
                incrementHltbMetric('hits');
                incrementHltbMetric('staleServed');
                const scheduled = scheduleHltbRevalidation(
                  cacheKey,
                  request,
                  normalized,
                  fetchMetadata,
                  pool,
                  scheduleBackgroundRefresh
                );
                reply.header('X-GameShelf-HLTB-Cache', 'HIT_STALE');
                reply.header('X-GameShelf-HLTB-Revalidate', scheduled ? 'scheduled' : 'skipped');
                reply.code(200).send(cachedRow.response_json);
                return;
              }
            }
          }
        } catch (error) {
          incrementHltbMetric('readErrors');
          incrementHltbMetric('bypasses');
          cacheOutcome = 'BYPASS';
          request.log.warn({
            msg: 'hltb_cache_read_failed',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      incrementHltbMetric('misses');
      const response = await fetchMetadata(request);

      if (cacheKey && normalized && response.ok) {
        const payload = await safeReadJson(response);

        if (payload !== null && isCacheableHltbPayload(normalized, payload)) {
          await persistHltbCacheEntry(pool, cacheKey, normalized, payload, request);
        }
      }

      reply.header('X-GameShelf-HLTB-Cache', cacheOutcome);
      await sendWebResponse(reply, response);
    }
  );
}

function normalizeHltbQuery(rawUrl: string): NormalizedHltbQuery | null {
  const url = new URL(rawUrl, 'http://game-shelf.local');
  const query = (url.searchParams.get('q') ?? '').trim();

  if (query.length < 2) {
    return null;
  }

  const rawYear = (url.searchParams.get('releaseYear') ?? '').trim();
  const releaseYear = /^\d{4}$/.test(rawYear) ? Number.parseInt(rawYear, 10) : null;
  const rawPlatform = (url.searchParams.get('platform') ?? '').trim();
  const platform = rawPlatform.length > 0 ? rawPlatform : null;
  const rawIncludeCandidates = String(url.searchParams.get('includeCandidates') ?? '')
    .trim()
    .toLowerCase();
  const includeCandidates =
    rawIncludeCandidates === '1' ||
    rawIncludeCandidates === 'true' ||
    rawIncludeCandidates === 'yes';

  return {
    query,
    releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
    platform,
    includeCandidates
  };
}

function buildCacheKey(query: NormalizedHltbQuery): string {
  const payload = JSON.stringify([
    query.query.toLowerCase(),
    query.releaseYear,
    query.platform?.toLowerCase() ?? null,
    query.includeCandidates
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

async function safeReadJson(response: Response): Promise<unknown | null> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function scheduleHltbRevalidation(
  cacheKey: string,
  request: FastifyRequest,
  normalizedQuery: NormalizedHltbQuery,
  fetchMetadata: (request: FastifyRequest) => Promise<Response>,
  pool: Pool,
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void
): boolean {
  if (revalidationInFlightByKey.has(cacheKey)) {
    incrementHltbMetric('revalidateSkipped');
    return false;
  }

  incrementHltbMetric('revalidateScheduled');

  let resolveDone: (() => void) | null = null;
  const inFlight = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  revalidationInFlightByKey.set(cacheKey, inFlight);

  scheduleBackgroundRefresh(async () => {
    try {
      const response = await fetchMetadata(request);

      if (!response.ok) {
        incrementHltbMetric('revalidateFailed');
        return;
      }

      const payload = await safeReadJson(response);

      if (payload === null) {
        incrementHltbMetric('revalidateFailed');
        return;
      }

      if (!isCacheableHltbPayload(normalizedQuery, payload)) {
        incrementHltbMetric('revalidateFailed');
        return;
      }

      await persistHltbCacheEntry(pool, cacheKey, normalizedQuery, payload, request);
      incrementHltbMetric('revalidateSucceeded');
    } catch (error) {
      incrementHltbMetric('revalidateFailed');
      request.log.warn({
        msg: 'hltb_cache_revalidate_failed',
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      revalidationInFlightByKey.delete(cacheKey);
      resolveDone?.();
    }
  });

  return true;
}

async function persistHltbCacheEntry(
  pool: Pool,
  cacheKey: string,
  normalizedQuery: NormalizedHltbQuery,
  payload: unknown,
  request: FastifyRequest
): Promise<void> {
  try {
    await pool.query(
      `
      INSERT INTO hltb_search_cache (cache_key, query_title, release_year, platform, include_candidates, response_json, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
      ON CONFLICT (cache_key)
      DO UPDATE SET
        response_json = EXCLUDED.response_json,
        updated_at = NOW()
      `,
      [
        cacheKey,
        normalizedQuery.query,
        normalizedQuery.releaseYear,
        normalizedQuery.platform,
        normalizedQuery.includeCandidates,
        JSON.stringify(payload)
      ]
    );
    incrementHltbMetric('writes');
  } catch (error) {
    incrementHltbMetric('writeErrors');
    request.log.warn({
      msg: 'hltb_cache_write_failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function isCacheableHltbPayload(normalizedQuery: NormalizedHltbQuery, payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const item = payloadRecord['item'];

  if (hasValidHltbItem(item)) {
    return true;
  }

  if (!normalizedQuery.includeCandidates) {
    return false;
  }

  const candidates = payloadRecord['candidates'];
  return Array.isArray(candidates) && candidates.length > 0;
}

function hasValidHltbItem(item: unknown): boolean {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const entry = item as Record<string, unknown>;
  return (
    isPositiveNumber(entry['hltbMainHours']) ||
    isPositiveNumber(entry['hltbMainExtraHours']) ||
    isPositiveNumber(entry['hltbCompletionistHours'])
  );
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function deleteHltbCacheEntry(
  pool: Pool,
  cacheKey: string,
  request: FastifyRequest
): Promise<void> {
  try {
    await pool.query('DELETE FROM hltb_search_cache WHERE cache_key = $1', [cacheKey]);
  } catch (error) {
    incrementHltbMetric('writeErrors');
    request.log.warn({
      msg: 'hltb_cache_delete_failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function fetchMetadataFromWorker(request: FastifyRequest): Promise<Response> {
  const baseUrl = readEnv('HLTB_SCRAPER_BASE_URL').trim();

  if (!baseUrl) {
    return new Response(JSON.stringify({ error: 'HLTB scraper base URL is not configured' }), {
      status: 503,
      headers: {
        'content-type': 'application/json'
      }
    });
  }

  const requestUrl = new URL(request.url, 'http://game-shelf.local');
  const targetUrl = new URL('/v1/hltb/search', baseUrl);
  targetUrl.search = requestUrl.search;

  const headers = new Headers();
  const scraperToken = readSecretFile('HLTB_SCRAPER_TOKEN', 'hltb_scraper_token').trim();

  if (scraperToken.length > 0) {
    headers.set('Authorization', `Bearer ${scraperToken}`);
  }

  try {
    return await fetch(targetUrl.toString(), {
      method: 'GET',
      headers
    });
  } catch (error) {
    request.log.warn({
      msg: 'hltb_scraper_request_failed',
      url: targetUrl.toString(),
      error: error instanceof Error ? error.message : String(error)
    });

    return new Response(JSON.stringify({ error: 'HLTB scraper request failed' }), {
      status: 502,
      headers: {
        'content-type': 'application/json'
      }
    });
  }
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
  response.headers.forEach((value, key) => {
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
