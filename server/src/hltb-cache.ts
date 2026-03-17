import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool } from 'pg';
import { incrementHltbMetric } from './cache-metrics.js';
import { config } from './config.js';
import {
  logUpstreamRequest,
  logUpstreamResponse,
  sanitizeUrlForDebugLogs,
} from './http-debug-log.js';

interface HltbCacheRow {
  response_json: unknown;
  updated_at: string;
}

interface NormalizedHltbQuery {
  query: string;
  releaseYear: number | null;
  platform: string | null;
  includeCandidates: boolean;
  preferredHltbGameId: number | null;
  preferredHltbUrl: string | null;
}

interface HltbCacheRouteOptions {
  fetchMetadata?: (request: FastifyRequest) => Promise<Response>;
  now?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: HltbCacheRevalidationPayload) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

export interface HltbCacheRevalidationPayload {
  cacheKey: string;
  requestUrl: string;
}

const DEFAULT_HLTB_CACHE_FRESH_TTL_SECONDS = 86400 * 7;
const DEFAULT_HLTB_CACHE_STALE_TTL_SECONDS = 86400 * 90;
const MAX_NORMALIZED_HLTB_URL_LENGTH = 2048;
const revalidationInFlightByKey = new Map<string, Promise<void>>();

export async function registerHltbCachedRoute(
  app: FastifyInstance,
  pool: Pool,
  options: HltbCacheRouteOptions = {}
): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, { global: false });
  }
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

  app.route({
    method: 'GET',
    url: '/v1/hltb/search',
    config: {
      rateLimit: {
        max: config.hltbSearchRateLimitMaxPerMinute,
        timeWindow: '1 minute',
      },
    },
    handler: async (request, reply) => {
      const normalized = normalizeHltbQuery(request.url);
      const cacheKey = normalized ? buildCacheKey(normalized) : null;
      let cacheOutcome: 'MISS' | 'BYPASS' = 'MISS';

      if (cacheKey) {
        try {
          const cached = await pool.query<HltbCacheRow>(
            'SELECT response_json, updated_at FROM hltb_search_cache WHERE cache_key = $1 LIMIT 1',
            [cacheKey]
          );
          const cachedRow = cached.rows[0] as HltbCacheRow | undefined;

          if (cachedRow) {
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

              if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds) {
                incrementHltbMetric('hits');
                incrementHltbMetric('staleServed');
                const scheduled = scheduleHltbRevalidation(
                  cacheKey,
                  request,
                  normalized,
                  fetchMetadata,
                  pool,
                  scheduleBackgroundRefresh,
                  options.enqueueRevalidationJob
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
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      incrementHltbMetric('misses');
      const response = await fetchMetadata(request);

      if (normalized && response.ok) {
        const payload = await safeReadJson(response);

        if (payload !== null) {
          const finalizedPayload = finalizeHltbPayload(normalized, payload);

          if (
            cacheKey &&
            finalizedPayload !== null &&
            isCacheableHltbPayload(normalized, finalizedPayload)
          ) {
            await persistHltbCacheEntry(pool, cacheKey, normalized, finalizedPayload, request);
          }

          reply.header('X-GameShelf-HLTB-Cache', cacheOutcome);
          reply.code(response.status);
          reply.type('application/json');
          reply.send(finalizedPayload);
          return;
        }
      }

      reply.header('X-GameShelf-HLTB-Cache', cacheOutcome);
      await sendWebResponse(reply, response);
    },
  });
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
  const rawIncludeCandidates = (url.searchParams.get('includeCandidates') ?? '')
    .trim()
    .toLowerCase();
  const preferredHltbGameId = normalizePositiveInteger(url.searchParams.get('preferredHltbGameId'));
  const preferredHltbUrl = normalizeHltbUrl(url.searchParams.get('preferredHltbUrl'));
  const includeCandidates =
    rawIncludeCandidates === '1' ||
    rawIncludeCandidates === 'true' ||
    rawIncludeCandidates === 'yes' ||
    preferredHltbGameId !== null ||
    preferredHltbUrl !== null;

  return {
    query,
    releaseYear: Number.isInteger(releaseYear) ? releaseYear : null,
    platform,
    includeCandidates,
    preferredHltbGameId,
    preferredHltbUrl,
  };
}

function buildCacheKey(query: NormalizedHltbQuery): string {
  const payload = JSON.stringify([
    query.query.toLowerCase(),
    query.releaseYear,
    query.platform?.toLowerCase() ?? null,
    query.includeCandidates,
    query.preferredHltbGameId,
    query.preferredHltbUrl,
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

function scheduleHltbRevalidation(
  cacheKey: string,
  request: FastifyRequest,
  normalizedQuery: NormalizedHltbQuery,
  fetchMetadata: (request: FastifyRequest) => Promise<Response>,
  pool: Pool,
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void,
  enqueueRevalidationJob?: (payload: HltbCacheRevalidationPayload) => void
): boolean {
  if (enqueueRevalidationJob) {
    incrementHltbMetric('revalidateScheduled');
    enqueueRevalidationJob({
      cacheKey,
      requestUrl: request.url,
    });
    return true;
  }

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

      const finalizedPayload = finalizeHltbPayload(normalizedQuery, payload);

      if (!isCacheableHltbPayload(normalizedQuery, finalizedPayload)) {
        incrementHltbMetric('revalidateFailed');
        return;
      }

      await persistHltbCacheEntry(pool, cacheKey, normalizedQuery, finalizedPayload, request);
      incrementHltbMetric('revalidateSucceeded');
    } catch (error) {
      incrementHltbMetric('revalidateFailed');
      request.log.warn({
        msg: 'hltb_cache_revalidate_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      revalidationInFlightByKey.delete(cacheKey);
      resolveDone?.();
    }
  });

  return true;
}

export async function processQueuedHltbCacheRevalidation(
  pool: Pool,
  payload: HltbCacheRevalidationPayload
): Promise<void> {
  const normalizedQuery = normalizeHltbQuery(payload.requestUrl);
  if (!normalizedQuery) {
    throw new Error('Invalid HLTB revalidation payload query.');
  }

  const response = await fetchHltbFromScraper(normalizedQuery);
  if (!response.ok) {
    throw new Error(`HLTB revalidation request failed with status ${String(response.status)}.`);
  }

  const parsed = await safeReadJson(response);
  const finalizedPayload = parsed === null ? null : finalizeHltbPayload(normalizedQuery, parsed);
  if (finalizedPayload === null || !isCacheableHltbPayload(normalizedQuery, finalizedPayload)) {
    throw new Error('HLTB revalidation returned uncacheable payload.');
  }

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
      payload.cacheKey,
      normalizedQuery.query,
      normalizedQuery.releaseYear,
      normalizedQuery.platform,
      normalizedQuery.includeCandidates,
      JSON.stringify(finalizedPayload),
    ]
  );
}

async function fetchHltbFromScraper(query: NormalizedHltbQuery): Promise<Response> {
  const baseUrl = readEnv('HLTB_SCRAPER_BASE_URL').trim();
  if (!baseUrl) {
    return new Response(JSON.stringify({ error: 'HLTB scraper base URL is not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  const targetUrl = new URL('/v1/hltb/search', baseUrl);
  targetUrl.searchParams.set('q', query.query);
  if (query.releaseYear !== null) {
    targetUrl.searchParams.set('releaseYear', String(query.releaseYear));
  }
  if (query.platform !== null) {
    targetUrl.searchParams.set('platform', query.platform);
  }
  if (query.includeCandidates) {
    targetUrl.searchParams.set('includeCandidates', '1');
  }
  if (query.preferredHltbGameId !== null) {
    targetUrl.searchParams.set('preferredHltbGameId', String(query.preferredHltbGameId));
  }
  if (query.preferredHltbUrl !== null) {
    targetUrl.searchParams.set('preferredHltbUrl', query.preferredHltbUrl);
  }

  const headers = new Headers();
  const scraperToken = readSecretFile('HLTB_SCRAPER_TOKEN', 'hltb_scraper_token').trim();
  if (scraperToken.length > 0) {
    headers.set('Authorization', `Bearer ${scraperToken}`);
  }

  try {
    return await fetch(targetUrl.toString(), { method: 'GET', headers });
  } catch {
    return new Response(JSON.stringify({ error: 'HLTB scraper request failed' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
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
        JSON.stringify(payload),
      ]
    );
    incrementHltbMetric('writes');
  } catch (error) {
    incrementHltbMetric('writeErrors');
    request.log.warn({
      msg: 'hltb_cache_write_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isCacheableHltbPayload(normalizedQuery: NormalizedHltbQuery, payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const item = payloadRecord['item'];
  const itemIsValid = hasValidHltbItem(item);

  if (!normalizedQuery.includeCandidates && itemIsValid) {
    return true;
  }

  if (!normalizedQuery.includeCandidates) {
    return false;
  }

  const candidates = payloadRecord['candidates'];
  return hasCacheableHltbCandidates(candidates);
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

function hasCacheableHltbCandidates(candidates: unknown): boolean {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return false;
  }

  return candidates.some((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }

    const entry = candidate as Record<string, unknown>;
    const imageUrl = entry['imageUrl'];

    return (
      (isPositiveNumber(entry['hltbMainHours']) ||
        isPositiveNumber(entry['hltbMainExtraHours']) ||
        isPositiveNumber(entry['hltbCompletionistHours'])) &&
      typeof imageUrl === 'string' &&
      imageUrl.trim().length > 0
    );
  });
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasPositiveCompletionTime(candidateRecord: Record<string, unknown>): boolean {
  return (
    isPositiveNumber(candidateRecord['hltbMainHours']) ||
    isPositiveNumber(candidateRecord['hltbMainExtraHours']) ||
    isPositiveNumber(candidateRecord['hltbCompletionistHours']) ||
    isPositiveNumber(candidateRecord['main']) ||
    isPositiveNumber(candidateRecord['mainPlus']) ||
    isPositiveNumber(candidateRecord['mainExtra']) ||
    isPositiveNumber(candidateRecord['completionist']) ||
    isPositiveNumber(candidateRecord['solo']) ||
    isPositiveNumber(candidateRecord['coOp']) ||
    isPositiveNumber(candidateRecord['vs'])
  );
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (isPositiveNumber(value)) {
      return value;
    }
  }

  return null;
}

function normalizePromotedHltbItem(
  candidateRecord: Record<string, unknown>
): Record<string, unknown> | null {
  const hltbMainHours = firstPositiveNumber(
    candidateRecord['hltbMainHours'],
    candidateRecord['main'],
    candidateRecord['solo'],
    candidateRecord['coOp'],
    candidateRecord['vs']
  );
  const hltbMainExtraHours = firstPositiveNumber(
    candidateRecord['hltbMainExtraHours'],
    candidateRecord['mainPlus'],
    candidateRecord['mainExtra']
  );
  const hltbCompletionistHours = firstPositiveNumber(
    candidateRecord['hltbCompletionistHours'],
    candidateRecord['completionist']
  );

  if (hltbMainHours === null && hltbMainExtraHours === null && hltbCompletionistHours === null) {
    return null;
  }

  return {
    ...candidateRecord,
    ...(hltbMainHours !== null ? { hltbMainHours } : {}),
    ...(hltbMainExtraHours !== null ? { hltbMainExtraHours } : {}),
    ...(hltbCompletionistHours !== null ? { hltbCompletionistHours } : {}),
  };
}

function finalizeHltbPayload(normalizedQuery: NormalizedHltbQuery, payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  if (normalizedQuery.preferredHltbGameId === null && normalizedQuery.preferredHltbUrl === null) {
    return payload;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const candidateEntries = payloadRecord['candidates'];
  const candidates: unknown[] = Array.isArray(candidateEntries) ? candidateEntries : [];
  const preferredCandidate =
    candidates.find((candidate) => matchesPreferredHltbCandidate(candidate, normalizedQuery)) ??
    null;

  if (!preferredCandidate) {
    return payload;
  }

  const preferredRecord = preferredCandidate as Record<string, unknown>;
  if (!hasPositiveCompletionTime(preferredRecord)) {
    return payload;
  }

  const normalizedPreferredItem = normalizePromotedHltbItem(preferredRecord);
  if (!normalizedPreferredItem) {
    return payload;
  }

  return {
    ...payloadRecord,
    item: normalizedPreferredItem,
  };
}

function matchesPreferredHltbCandidate(
  candidate: unknown,
  normalizedQuery: NormalizedHltbQuery
): boolean {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  const candidateRecord = candidate as Record<string, unknown>;
  const candidateGameId = normalizePositiveInteger(
    candidateRecord['hltbGameId'] ?? candidateRecord['gameId'] ?? candidateRecord['id'] ?? null
  );
  const candidateUrl = normalizeHltbUrl(
    candidateRecord['hltbUrl'] ?? candidateRecord['gameUrl'] ?? candidateRecord['url'] ?? null
  );

  return (
    (normalizedQuery.preferredHltbGameId !== null &&
      candidateGameId === normalizedQuery.preferredHltbGameId) ||
    (normalizedQuery.preferredHltbUrl !== null && candidateUrl === normalizedQuery.preferredHltbUrl)
  );
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
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

function normalizeHltbUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  let normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  } else if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice('http://'.length)}`;
  } else if (normalized.startsWith('/')) {
    normalized = `https://howlongtobeat.com${normalized}`;
  } else if (!normalized.startsWith('https://')) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'howlongtobeat.com' && hostname !== 'www.howlongtobeat.com') {
    return null;
  }

  parsed.protocol = 'https:';
  parsed.hostname = 'howlongtobeat.com';
  parsed.port = '';

  const href = parsed.href;
  return href.length <= MAX_NORMALIZED_HLTB_URL_LENGTH ? href : null;
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
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function fetchMetadataFromWorker(request: FastifyRequest): Promise<Response> {
  const baseUrl = readEnv('HLTB_SCRAPER_BASE_URL').trim();

  if (!baseUrl) {
    return new Response(JSON.stringify({ error: 'HLTB scraper base URL is not configured' }), {
      status: 503,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  const requestUrl = new URL(request.url, 'http://game-shelf.local');
  const targetUrl = new URL('/v1/hltb/search', baseUrl);
  targetUrl.search = requestUrl.search;
  if (
    targetUrl.searchParams.get('includeCandidates') == null &&
    (normalizePositiveInteger(targetUrl.searchParams.get('preferredHltbGameId')) !== null ||
      normalizeHltbUrl(targetUrl.searchParams.get('preferredHltbUrl')) !== null)
  ) {
    targetUrl.searchParams.set('includeCandidates', '1');
  }

  const headers = new Headers();
  const scraperToken = readSecretFile('HLTB_SCRAPER_TOKEN', 'hltb_scraper_token').trim();

  if (scraperToken.length > 0) {
    headers.set('Authorization', `Bearer ${scraperToken}`);
  }

  try {
    logUpstreamRequest(request, {
      method: 'GET',
      url: targetUrl.toString(),
      headers,
    });
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers,
    });
    await logUpstreamResponse(request, {
      method: 'GET',
      url: targetUrl.toString(),
      response,
    });
    return response;
  } catch (error) {
    request.log.warn({
      msg: 'hltb_scraper_request_failed',
      url: sanitizeUrlForDebugLogs(targetUrl.toString()),
      error: error instanceof Error ? error.message : String(error),
    });

    return new Response(JSON.stringify({ error: 'HLTB scraper request failed' }), {
      status: 502,
      headers: {
        'content-type': 'application/json',
      },
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
