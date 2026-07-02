import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, QueryResultRow } from 'pg';
import { BackgroundJobRepository } from './background-jobs.js';
import { config } from './config.js';
import { isProviderMatchLocked } from './provider-match-lock.js';
import { STEAM_WINDOWS_PLATFORM_IGDB_ID, PSPRICES_PLATFORM_IGDB_IDS } from './platform-ids.js';
import { resolvePreferredPsPricesUrl } from './psprices-url.js';
import {
  maybeRearmProviderRetryState,
  parseProviderRetryState,
  shouldAttemptProvider,
} from './recommendations/provider-retry-state.js';
import { RECOMMENDATION_RUNTIME_MODES } from './recommendations/runtime.js';
import { enqueueForcedReleaseMonitorRefreshJobs } from './release-monitor.js';
import { DISCOVERY_RECOMMENDATION_ALLOWED_STATUSES } from './recommendations/types.js';
import { applyRouteRateLimit } from './rate-limit.js';
import { CLIENT_WRITE_TOKEN_HEADER_NAME, isAuthorizedMutatingRequest } from './request-security.js';
import { runWithConcurrencyLimit } from './utils/concurrency.js';

const PRICING_ENQUEUE_CONCURRENCY = 5;

type DataType = 'hltb' | 'reviews' | 'igdb' | 'pricing';
const KNOWN_DATA_TYPES: ReadonlySet<DataType> = new Set(['hltb', 'reviews', 'igdb', 'pricing']);

interface RefreshDataBody {
  dataTypes?: unknown;
}

interface DataTypeResult {
  scanned?: number;
  enqueued: number;
  deduped: number;
}

interface PricingCandidateRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: unknown;
}

export function registerAdminRefreshDataRoutes(app: FastifyInstance, pool: Pool): void {
  const backgroundJobs = new BackgroundJobRepository(pool);

  app.post(
    '/v1/admin/refresh-data',
    {
      config: applyRouteRateLimit('admin_refresh_data'),
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const body = (request.body ?? {}) as RefreshDataBody;
      const dataTypes = parseDataTypes(body.dataTypes);
      if (dataTypes === null) {
        reply.code(400).send({
          error:
            'dataTypes must be a non-empty array containing only hltb, reviews, igdb, pricing.',
        });
        return;
      }

      const results: Partial<Record<DataType, DataTypeResult>> = {};

      if (dataTypes.has('hltb') || dataTypes.has('reviews')) {
        const forced = await enqueueForcedReleaseMonitorRefreshJobs(pool, {
          hltb: dataTypes.has('hltb'),
          review: dataTypes.has('reviews'),
        });
        const shared: DataTypeResult = {
          scanned: forced.scanned,
          enqueued: forced.enqueued,
          deduped: forced.deduped,
        };
        if (dataTypes.has('hltb')) {
          results.hltb = shared;
        }
        if (dataTypes.has('reviews')) {
          results.reviews = shared;
        }
      }

      if (dataTypes.has('igdb')) {
        const queued = await backgroundJobs.enqueue({
          jobType: 'metadata_enrichment_run',
          dedupeKey: 'metadata-enrichment:admin-refresh-force',
          payload: {
            force: true,
            requestedAt: new Date().toISOString(),
            requestedBy: 'admin-refresh-data',
          },
          priority: 90,
          maxAttempts: 3,
        });
        results.igdb = queued.deduped ? { enqueued: 0, deduped: 1 } : { enqueued: 1, deduped: 0 };
      }

      if (dataTypes.has('pricing')) {
        const wishlist = await enqueueForcedWishlistPricingRefreshJobs(
          pool,
          backgroundJobs,
          config.adminForcedRefreshMaxGames
        );
        const discoveryMaxRows = Math.max(0, config.adminForcedRefreshMaxGames - wishlist.scanned);
        const discovery =
          discoveryMaxRows > 0
            ? await enqueueForcedDiscoveryPricingRefreshJobs(pool, backgroundJobs, discoveryMaxRows)
            : { scanned: 0, enqueued: 0, deduped: 0 };
        results.pricing = {
          scanned: wishlist.scanned + discovery.scanned,
          enqueued: wishlist.enqueued + discovery.enqueued,
          deduped: wishlist.deduped + discovery.deduped,
        };
      }

      const totals = Object.values(results).reduce(
        (accumulator, result) => ({
          enqueued: accumulator.enqueued + result.enqueued,
          deduped: accumulator.deduped + result.deduped,
        }),
        { enqueued: 0, deduped: 0 }
      );

      reply.send({
        ok: true,
        requestedDataTypes: [...dataTypes],
        results,
        totals,
      });
    }
  );
}

function parseDataTypes(value: unknown): Set<DataType> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const dataTypes = new Set<DataType>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !KNOWN_DATA_TYPES.has(entry as DataType)) {
      return null;
    }
    dataTypes.add(entry as DataType);
  }

  return dataTypes.size > 0 ? dataTypes : null;
}

function isAdminAuthorized(
  request: FastifyRequest,
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } }
): boolean {
  const authorized = isAuthorizedMutatingRequest({
    requireAuth: config.requireAuth,
    apiToken: config.apiToken,
    clientWriteTokens: config.clientWriteTokens,
    authorizationHeader: request.headers.authorization,
    clientWriteTokenHeader: request.headers[CLIENT_WRITE_TOKEN_HEADER_NAME],
  });

  if (!authorized) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

interface PricingEnqueueStats {
  scanned: number;
  enqueued: number;
  deduped: number;
}

async function enqueueForcedWishlistPricingRefreshJobs(
  pool: Pool,
  backgroundJobs: BackgroundJobRepository,
  maxRows: number
): Promise<PricingEnqueueStats> {
  const rows = await pool.query<PricingCandidateRow>(
    `
    SELECT igdb_game_id, platform_igdb_id, payload
    FROM games
    WHERE payload->>'listType' = 'wishlist'
      AND (platform_igdb_id = $1 OR platform_igdb_id = ANY($2::int[]))
    ORDER BY igdb_game_id ASC, platform_igdb_id ASC
    LIMIT $3
    `,
    [STEAM_WINDOWS_PLATFORM_IGDB_ID, [...PSPRICES_PLATFORM_IGDB_IDS], maxRows]
  );

  const steamCountry = config.steamDefaultCountry;
  const pspricesRegion = config.pspricesRegionPath.toLowerCase();
  const pspricesShow = config.pspricesShow.toLowerCase();
  const jobs: Array<() => Promise<{ deduped: boolean }>> = [];

  for (const row of rows.rows) {
    const payload = normalizePayloadObject(row.payload);
    if (payload === null) {
      continue;
    }

    if (row.platform_igdb_id === STEAM_WINDOWS_PLATFORM_IGDB_ID) {
      const steamAppId = normalizePositiveInteger(payload['steamAppId']);
      if (steamAppId === null) {
        continue;
      }

      jobs.push(() =>
        backgroundJobs.enqueue({
          jobType: 'steam_price_revalidate',
          dedupeKey: `admin-refresh-force:wishlist:steam:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${steamCountry}:${String(steamAppId)}`,
          payload: {
            cacheKey: `admin-refresh-force:wishlist:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${steamCountry}:${String(steamAppId)}`,
            igdbGameId: row.igdb_game_id,
            platformIgdbId: row.platform_igdb_id,
            cc: steamCountry,
            steamAppId,
          },
          priority: 120,
          maxAttempts: 3,
        })
      );
      continue;
    }

    if (!PSPRICES_PLATFORM_IGDB_IDS.has(row.platform_igdb_id)) {
      continue;
    }

    const title =
      normalizeString(payload['psPricesMatchQueryTitle']) ?? normalizeString(payload['title']);
    if (title === null) {
      continue;
    }

    jobs.push(() =>
      backgroundJobs.enqueue({
        jobType: 'psprices_price_revalidate',
        dedupeKey: `admin-refresh-force:wishlist:psprices:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${pspricesRegion}:${pspricesShow}`,
        payload: {
          cacheKey: `admin-refresh-force:wishlist:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${pspricesRegion}:${pspricesShow}`,
          igdbGameId: row.igdb_game_id,
          platformIgdbId: row.platform_igdb_id,
          title,
          psPricesUrl: resolvePreferredPsPricesUrl(payload),
        },
        priority: 120,
        maxAttempts: 3,
      })
    );
  }

  const results = await runWithConcurrencyLimit(jobs, PRICING_ENQUEUE_CONCURRENCY);
  const enqueued = results.filter((result) => !result.deduped).length;
  const deduped = results.filter((result) => result.deduped).length;

  return { scanned: rows.rows.length, enqueued, deduped };
}

async function enqueueForcedDiscoveryPricingRefreshJobs(
  pool: Pool,
  backgroundJobs: BackgroundJobRepository,
  maxRows: number
): Promise<PricingEnqueueStats> {
  const perModeTopLimit = Math.max(1, config.recommendationsTopLimit);
  const rows = await pool.query<PricingCandidateRow>(
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
    ORDER BY games.igdb_game_id ASC, games.platform_igdb_id ASC
    LIMIT $4
    `,
    [
      RECOMMENDATION_RUNTIME_MODES,
      [...DISCOVERY_RECOMMENDATION_ALLOWED_STATUSES],
      perModeTopLimit,
      maxRows,
    ]
  );

  const steamCountry = config.steamDefaultCountry;
  const pspricesRegion = config.pspricesRegionPath.toLowerCase();
  const pspricesShow = config.pspricesShow.toLowerCase();
  const nowMs = Date.now();
  const jobs: Array<() => Promise<{ deduped: boolean }>> = [];

  for (const row of rows.rows) {
    const payload = normalizePayloadObject(row.payload);
    if (payload === null) {
      continue;
    }

    if (row.platform_igdb_id === STEAM_WINDOWS_PLATFORM_IGDB_ID) {
      const steamAppId = normalizePositiveInteger(payload['steamAppId']);
      if (steamAppId === null) {
        continue;
      }

      jobs.push(() =>
        backgroundJobs.enqueue({
          jobType: 'steam_price_revalidate',
          dedupeKey: `admin-refresh-force:discovery:steam:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${steamCountry}:${String(steamAppId)}`,
          payload: {
            cacheKey: `admin-refresh-force:discovery:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${steamCountry}:${String(steamAppId)}`,
            igdbGameId: row.igdb_game_id,
            platformIgdbId: row.platform_igdb_id,
            cc: steamCountry,
            steamAppId,
          },
          priority: 120,
          maxAttempts: 3,
        })
      );
      continue;
    }

    if (!PSPRICES_PLATFORM_IGDB_IDS.has(row.platform_igdb_id)) {
      continue;
    }

    if (isProviderMatchLocked(payload, 'psPricesMatchLocked')) {
      continue;
    }

    const retryState = maybeRearmProviderRetryState({
      state: parseProviderRetryState(readEnrichmentRetryState(payload, 'psprices')),
      nowMs,
      releaseYear: normalizePositiveInteger(payload['releaseYear']),
      rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
      rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears,
      maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
    });
    if (
      !shouldAttemptProvider({
        state: retryState,
        nowMs,
        maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
      })
    ) {
      continue;
    }

    const title =
      normalizeString(payload['psPricesMatchQueryTitle']) ?? normalizeString(payload['title']);
    if (title === null) {
      continue;
    }

    jobs.push(() =>
      backgroundJobs.enqueue({
        jobType: 'psprices_price_revalidate',
        dedupeKey: `admin-refresh-force:discovery:psprices:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${pspricesRegion}:${pspricesShow}`,
        payload: {
          cacheKey: `admin-refresh-force:discovery:${row.igdb_game_id}:${String(row.platform_igdb_id)}:${pspricesRegion}:${pspricesShow}`,
          igdbGameId: row.igdb_game_id,
          platformIgdbId: row.platform_igdb_id,
          title,
          psPricesUrl: resolvePreferredPsPricesUrl(payload),
        },
        priority: 120,
        maxAttempts: 3,
      })
    );
  }

  const results = await runWithConcurrencyLimit(jobs, PRICING_ENQUEUE_CONCURRENCY);
  const enqueued = results.filter((result) => !result.deduped).length;
  const deduped = results.filter((result) => result.deduped).length;

  return { scanned: rows.rows.length, enqueued, deduped };
}

function readEnrichmentRetryState(
  payload: Record<string, unknown>,
  providerKey: 'hltb' | 'metacritic' | 'steam' | 'psprices'
): unknown {
  const retry = payload['enrichmentRetry'];
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) {
    return null;
  }
  return (retry as Record<string, unknown>)[providerKey];
}

function normalizePayloadObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}
