import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool } from 'pg';
import { incrementIgdbMetric } from './cache-metrics.js';
import { config } from './config.js';
import { fetchMetadataPathFromWorker, sendWebResponse } from './metadata.js';

interface IgdbCacheRow {
  response_json: unknown;
  updated_at: string;
}

interface NormalizedIgdbGameIdRequest {
  gameId: string;
}

interface IgdbCacheRouteOptions {
  fetchMetadata?: (gameId: string) => Promise<Response>;
  now?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

const DEFAULT_IGDB_CACHE_FRESH_TTL_SECONDS = 86400 * 7;
const DEFAULT_IGDB_CACHE_STALE_TTL_SECONDS = 86400 * 90;
const revalidationInFlightByKey = new Map<string, Promise<void>>();

export async function registerIgdbCachedByIdRoute(
  app: FastifyInstance,
  pool: Pool,
  options: IgdbCacheRouteOptions = {}
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
    DEFAULT_IGDB_CACHE_FRESH_TTL_SECONDS
  );
  const staleTtlSeconds = Math.max(
    freshTtlSeconds,
    normalizeTtlSeconds(options.staleTtlSeconds, DEFAULT_IGDB_CACHE_STALE_TTL_SECONDS)
  );

  app.route({
    method: 'GET',
    url: '/v1/games/:id',
    config: {
      rateLimit: {
        max: config.gameByIdRateLimitMaxRequests,
        timeWindow: config.gameByIdRateLimitWindowMs,
      },
    },
    handler: async (request, reply) => {
      const normalized = normalizeIgdbGameIdRequest(request.params);
      if (!normalized) {
        incrementIgdbMetric('bypasses');
        reply.header('X-GameShelf-IGDB-Cache', 'BYPASS');
        reply.code(404).send({ error: 'Not found' });
        return;
      }

      const cacheKey = normalized.gameId;
      let cacheOutcome: 'MISS' | 'BYPASS' = 'MISS';

      if (cacheKey) {
        try {
          const cached = await pool.query<IgdbCacheRow>(
            'SELECT response_json, updated_at FROM igdb_game_cache WHERE cache_key = $1 LIMIT 1',
            [cacheKey]
          );
          const cachedRow = cached.rows[0] as IgdbCacheRow | undefined;

          if (cachedRow) {
            if (!isCacheableIgdbPayload(normalized, cachedRow.response_json)) {
              await deleteIgdbCacheEntry(pool, cacheKey, request);
            } else {
              const ageSeconds = getAgeSeconds(cachedRow.updated_at, now());

              if (ageSeconds <= freshTtlSeconds) {
                incrementIgdbMetric('hits');
                reply.header('X-GameShelf-IGDB-Cache', 'HIT_FRESH');
                reply.code(200).send(cachedRow.response_json);
                return;
              }

              if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds) {
                incrementIgdbMetric('hits');
                incrementIgdbMetric('staleServed');
                const scheduled = scheduleIgdbRevalidation(
                  cacheKey,
                  request,
                  normalized,
                  fetchMetadata,
                  pool,
                  scheduleBackgroundRefresh
                );
                reply.header('X-GameShelf-IGDB-Cache', 'HIT_STALE');
                reply.header('X-GameShelf-IGDB-Revalidate', scheduled ? 'scheduled' : 'skipped');
                reply.code(200).send(cachedRow.response_json);
                return;
              }
            }
          }
        } catch (error) {
          incrementIgdbMetric('readErrors');
          incrementIgdbMetric('bypasses');
          cacheOutcome = 'BYPASS';
          request.log.warn({
            msg: 'igdb_cache_read_failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (cacheOutcome === 'MISS') {
        incrementIgdbMetric('misses');
      }

      const response = await fetchMetadata(normalized.gameId);

      if (response.ok) {
        const payload = await safeReadJson(response);

        if (payload !== null && isCacheableIgdbPayload(normalized, payload)) {
          await cancelResponseBody(response);
          await persistIgdbCacheEntry(pool, cacheKey, normalized, payload, request);
          reply.header('X-GameShelf-IGDB-Cache', cacheOutcome);
          reply.code(response.status);
          reply.type('application/json');
          reply.send(payload);
          return;
        }
      }

      reply.header('X-GameShelf-IGDB-Cache', cacheOutcome);
      await sendWebResponse(reply, response);
    },
  });
}

function normalizeIgdbGameIdRequest(params: unknown): NormalizedIgdbGameIdRequest | null {
  const rawId =
    params &&
    typeof params === 'object' &&
    typeof (params as Record<string, unknown>)['id'] === 'string'
      ? (params as Record<string, string>)['id'].trim()
      : '';

  if (!/^\d+$/.test(rawId)) {
    return null;
  }

  const parsedId = Number.parseInt(rawId, 10);

  if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
    return null;
  }

  return { gameId: String(parsedId) };
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

function scheduleIgdbRevalidation(
  cacheKey: string,
  request: FastifyRequest,
  normalizedRequest: NormalizedIgdbGameIdRequest,
  fetchMetadata: (gameId: string) => Promise<Response>,
  pool: Pool,
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void
): boolean {
  if (revalidationInFlightByKey.has(cacheKey)) {
    incrementIgdbMetric('revalidateSkipped');
    return false;
  }

  let resolveDone: (() => void) | null = null;
  const inFlight = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  revalidationInFlightByKey.set(cacheKey, inFlight);

  try {
    scheduleBackgroundRefresh(async () => {
      try {
        const response = await fetchMetadata(normalizedRequest.gameId);

        if (!response.ok) {
          incrementIgdbMetric('revalidateFailed');
          return;
        }

        const payload = await safeReadJson(response);

        if (payload === null || !isCacheableIgdbPayload(normalizedRequest, payload)) {
          incrementIgdbMetric('revalidateFailed');
          return;
        }

        await cancelResponseBody(response);
        await persistIgdbCacheEntry(pool, cacheKey, normalizedRequest, payload, request);
        incrementIgdbMetric('revalidateSucceeded');
      } catch (error) {
        incrementIgdbMetric('revalidateFailed');
        request.log.warn({
          msg: 'igdb_cache_revalidate_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        revalidationInFlightByKey.delete(cacheKey);
        resolveDone?.();
      }
    });
    incrementIgdbMetric('revalidateScheduled');
  } catch (error) {
    incrementIgdbMetric('revalidateFailed');
    revalidationInFlightByKey.delete(cacheKey);
    resolveDone?.();
    request.log.warn({
      msg: 'igdb_cache_revalidate_schedule_failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  return true;
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }

  try {
    await response.body.cancel();
  } catch {
    // Ignore cancel errors because cancellation is best-effort cleanup.
  }
}

async function persistIgdbCacheEntry(
  pool: Pool,
  cacheKey: string,
  normalizedRequest: NormalizedIgdbGameIdRequest,
  payload: unknown,
  request: FastifyRequest
): Promise<void> {
  try {
    await pool.query(
      `
      INSERT INTO igdb_game_cache (cache_key, igdb_game_id, response_json, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW())
      ON CONFLICT (cache_key)
      DO UPDATE SET
        response_json = EXCLUDED.response_json,
        updated_at = NOW()
      `,
      [cacheKey, normalizedRequest.gameId, JSON.stringify(payload)]
    );
    incrementIgdbMetric('writes');
  } catch (error) {
    incrementIgdbMetric('writeErrors');
    request.log.warn({
      msg: 'igdb_cache_write_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isCacheableIgdbPayload(
  normalizedRequest: NormalizedIgdbGameIdRequest,
  payload: unknown
): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const item = (payload as Record<string, unknown>)['item'];

  if (!item || typeof item !== 'object') {
    return false;
  }

  const entry = item as Record<string, unknown>;
  return (
    typeof entry['igdbGameId'] === 'string' &&
    entry['igdbGameId'] === normalizedRequest.gameId &&
    typeof entry['title'] === 'string' &&
    entry['title'].trim().length > 0
  );
}

async function deleteIgdbCacheEntry(
  pool: Pool,
  cacheKey: string,
  request: FastifyRequest
): Promise<void> {
  try {
    await pool.query('DELETE FROM igdb_game_cache WHERE cache_key = $1', [cacheKey]);
  } catch (error) {
    incrementIgdbMetric('writeErrors');
    request.log.warn({
      msg: 'igdb_cache_delete_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function fetchMetadataFromWorker(gameId: string): Promise<Response> {
  return fetchMetadataPathFromWorker(`/v1/games/${gameId}`);
}

export const __igdbCacheTestables = {
  normalizeIgdbGameIdRequest,
  getAgeSeconds,
  isCacheableIgdbPayload,
  persistIgdbCacheEntry,
};
