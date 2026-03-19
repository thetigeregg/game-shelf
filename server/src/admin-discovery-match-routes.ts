import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { BackgroundJobRepository } from './background-jobs.js';
import { config } from './config.js';
import { normalizeDiscoveryGameKeys, parseDiscoveryGameKeys } from './discovery-game-keys.js';
import { isProviderMatchLocked } from './provider-match-lock.js';
import { resolvePreferredPsPricesUrl } from './psprices-url.js';
import {
  createEmptyProviderRetryState,
  maybeRearmProviderRetryState,
  parseProviderRetryState,
  shouldAttemptProvider,
  type ProviderRetryState,
} from './recommendations/provider-retry-state.js';
import { CLIENT_WRITE_TOKEN_HEADER_NAME, isAuthorizedMutatingRequest } from './request-security.js';

type DiscoveryMatchProvider = 'hltb' | 'review' | 'pricing';
type ClearableDiscoveryMatchProvider = 'hltb' | 'review';
type DiscoveryMatchStateStatus = 'matched' | 'missing' | 'retrying' | 'permanentMiss';

interface DiscoveryGameRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: unknown;
}

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>>;
}

interface NormalizedDiscoveryGame {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
}

interface ListQuery {
  provider?: unknown;
  state?: unknown;
  search?: unknown;
  limit?: unknown;
}

interface DetailParams {
  igdbGameId?: unknown;
  platformIgdbId?: unknown;
}

interface PatchBody {
  provider?: unknown;
  hltbGameId?: unknown;
  hltbUrl?: unknown;
  hltbMainHours?: unknown;
  hltbMainExtraHours?: unknown;
  hltbCompletionistHours?: unknown;
  reviewSource?: unknown;
  reviewScore?: unknown;
  reviewUrl?: unknown;
  metacriticScore?: unknown;
  metacriticUrl?: unknown;
  mobygamesGameId?: unknown;
  mobyScore?: unknown;
  priceSource?: unknown;
  priceFetchedAt?: unknown;
  priceAmount?: unknown;
  priceCurrency?: unknown;
  priceRegularAmount?: unknown;
  priceDiscountPercent?: unknown;
  priceIsFree?: unknown;
  priceUrl?: unknown;
  psPricesUrl?: unknown;
  psPricesTitle?: unknown;
  psPricesPlatform?: unknown;
  queryTitle?: unknown;
  queryReleaseYear?: unknown;
  queryPlatform?: unknown;
}

interface ClearPermanentMissBody {
  provider?: unknown;
  gameKeys?: unknown;
}

interface RequeueDiscoveryEnrichmentBody {
  provider?: unknown;
  gameKeys?: unknown;
}

interface AdminRequeueResult {
  jobId: number | null;
  queued: boolean;
  deduped: boolean;
  queuedCount: number;
  dedupedCount: number;
}

interface DiscoveryProviderState {
  status: DiscoveryMatchStateStatus;
  locked: boolean;
  attempts: number;
  lastTriedAt: string | null;
  nextTryAt: string | null;
  permanentMiss: boolean;
}

const LIST_RATE_LIMIT = {
  max: 20,
  timeWindow: '1 minute',
} as const;

const DETAIL_RATE_LIMIT = {
  max: 30,
  timeWindow: '1 minute',
} as const;

const MUTATION_RATE_LIMIT = {
  max: 10,
  timeWindow: '1 minute',
} as const;

const MAX_LIST_LIMIT = 200;
const DEFAULT_LIST_LIMIT = 50;
const DISCOVERY_SCAN_LIMIT = 1000;
const STEAM_WINDOWS_PLATFORM_IGDB_ID = 6;
const PSPRICES_PLATFORM_IGDB_IDS = new Set<number>([48, 167, 130, 508]);
const PRICING_REQUEUE_CONCURRENCY = 5;

export function registerAdminDiscoveryMatchRoutes(app: FastifyInstance, pool: Pool): void {
  const backgroundJobs = new BackgroundJobRepository(pool);

  app.get(
    '/v1/admin/discovery/matches/unmatched',
    {
      config: {
        rateLimit: LIST_RATE_LIMIT,
      },
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const query = (request.query ?? {}) as ListQuery;
      const provider = parseProvider(query.provider);
      const state = parseStateFilter(query.state);
      const search = normalizeSearch(query.search);
      const limit = parseLimit(query.limit, DEFAULT_LIST_LIMIT);
      const rows = await listDiscoveryRows(pool, search, Math.min(DISCOVERY_SCAN_LIMIT, limit * 5));

      const items = rows
        .map((row) => mapDiscoveryListItem(row))
        .filter((item) => matchesListFilter(item.matchState, provider, state))
        .slice(0, limit);

      reply.send({
        count: items.length,
        scanned: rows.length,
        items,
      });
    }
  );

  app.post(
    '/v1/admin/discovery/requeue-enrichment',
    {
      config: {
        rateLimit: MUTATION_RATE_LIMIT,
      },
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const body = (request.body ?? {}) as RequeueDiscoveryEnrichmentBody;
      const provider = parseProvider(body.provider);
      const requestedKeys = parseGameKeys(body.gameKeys);
      if (Array.isArray(body.gameKeys) && requestedKeys !== null && requestedKeys.size === 0) {
        reply
          .code(400)
          .send({
            error: 'At least one valid discovery game key is required when gameKeys is provided.',
          });
        return;
      }

      if (provider === 'pricing') {
        const games = requestedKeys
          ? await listDiscoveryGamesByKeys(pool, requestedKeys)
          : await listDiscoveryRows(pool, null, DISCOVERY_SCAN_LIMIT);
        const enqueueResult = await enqueuePricingRefreshJobs(backgroundJobs, games, {
          requestedBy: 'admin-discovery-match-list',
          ignorePsPricesLock: true,
        });
        reply.send({ ok: true, ...enqueueResult });
        return;
      }

      const enqueueResult = await enqueueDiscoveryEnrichmentRun(backgroundJobs, {
        requestedBy: 'admin-discovery-match-list',
        gameKeys: requestedKeys === null ? undefined : [...requestedKeys],
        ...(provider !== null ? { providers: [provider] } : {}),
      });

      reply.send({ ok: true, ...toAdminRequeueResult([enqueueResult]) });
    }
  );

  app.get(
    '/v1/admin/discovery/games/:igdbGameId/:platformIgdbId/match-state',
    {
      config: {
        rateLimit: DETAIL_RATE_LIMIT,
      },
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const params = request.params as DetailParams;
      const game = await getDiscoveryGame(pool, params.igdbGameId, params.platformIgdbId);
      if (!game) {
        reply.code(404).send({ error: 'Discovery game not found.' });
        return;
      }

      reply.send(buildDetailResponse(game.igdbGameId, game.platformIgdbId, game.payload));
    }
  );

  app.patch(
    '/v1/admin/discovery/games/:igdbGameId/:platformIgdbId/match',
    {
      config: {
        rateLimit: MUTATION_RATE_LIMIT,
      },
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const params = request.params as DetailParams;
      const body = (request.body ?? {}) as PatchBody;
      const provider = parseRequiredProvider(body.provider);
      if (!provider) {
        reply.code(400).send({ error: 'A valid provider is required.' });
        return;
      }

      const mutationResult = await withTransaction(pool, async (client) => {
        const game = await getDiscoveryGame(client, params.igdbGameId, params.platformIgdbId);
        if (!game) {
          return { kind: 'not_found' } as const;
        }

        const relatedGames = await listDiscoveryGamesByIgdbGameId(client, game.igdbGameId);
        const nextPayload = structuredClone(game.payload);
        const error = applyManualMatchPatch(nextPayload, game.platformIgdbId, provider, body);
        if (error) {
          return { kind: 'invalid', error } as const;
        }

        let changed = false;
        for (const relatedGame of relatedGames) {
          const relatedPayload = structuredClone(relatedGame.payload);
          applyManualMatchPatch(relatedPayload, relatedGame.platformIgdbId, provider, body);
          const didChange = await replaceDiscoveryPayload(
            client,
            relatedGame.igdbGameId,
            relatedGame.platformIgdbId,
            relatedPayload
          );
          changed = changed || didChange;
        }

        return {
          kind: 'ok',
          changed,
          item: buildDetailResponse(game.igdbGameId, game.platformIgdbId, nextPayload),
        } as const;
      });

      if (mutationResult.kind === 'not_found') {
        reply.code(404).send({ error: 'Discovery game not found.' });
        return;
      }
      if (mutationResult.kind === 'invalid') {
        reply.code(400).send({ error: mutationResult.error });
        return;
      }

      reply.send({
        ok: true,
        changed: mutationResult.changed,
        provider,
        item: mutationResult.item,
      });
    }
  );

  app.delete(
    '/v1/admin/discovery/games/:igdbGameId/:platformIgdbId/match/:provider',
    {
      config: {
        rateLimit: MUTATION_RATE_LIMIT,
      },
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const params = request.params as DetailParams & { provider?: unknown };
      const provider = parseRequiredProvider(params.provider);
      if (!provider) {
        reply.code(400).send({ error: 'A valid provider is required.' });
        return;
      }

      const mutationResult = await withTransaction(pool, async (client) => {
        const game = await getDiscoveryGame(client, params.igdbGameId, params.platformIgdbId);
        if (!game) {
          return { kind: 'not_found' } as const;
        }

        const relatedGames = await listDiscoveryGamesByIgdbGameId(client, game.igdbGameId);
        const nextPayload = structuredClone(game.payload);
        clearManualMatch(nextPayload, provider);
        let changed = false;
        for (const relatedGame of relatedGames) {
          const relatedPayload = structuredClone(relatedGame.payload);
          clearManualMatch(relatedPayload, provider);
          const didChange = await replaceDiscoveryPayload(
            client,
            relatedGame.igdbGameId,
            relatedGame.platformIgdbId,
            relatedPayload
          );
          changed = changed || didChange;
        }

        return {
          kind: 'ok',
          changed,
          item: buildDetailResponse(game.igdbGameId, game.platformIgdbId, nextPayload),
        } as const;
      });

      if (mutationResult.kind === 'not_found') {
        reply.code(404).send({ error: 'Discovery game not found.' });
        return;
      }

      reply.send({
        ok: true,
        changed: mutationResult.changed,
        provider,
        item: mutationResult.item,
      });
    }
  );

  app.post(
    '/v1/admin/discovery/games/:igdbGameId/:platformIgdbId/requeue-enrichment',
    {
      config: {
        rateLimit: MUTATION_RATE_LIMIT,
      },
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const params = request.params as DetailParams;
      const body = (request.body ?? {}) as RequeueDiscoveryEnrichmentBody;
      const provider = parseProvider(body.provider);
      const game = await getDiscoveryGame(pool, params.igdbGameId, params.platformIgdbId);
      if (!game) {
        reply.code(404).send({ error: 'Discovery game not found.' });
        return;
      }

      const relatedGames = await listDiscoveryGamesByIgdbGameId(pool, game.igdbGameId);

      if (provider === 'pricing') {
        const enqueueResult = await enqueuePricingRefreshJobs(backgroundJobs, relatedGames, {
          requestedBy: 'admin-discovery-match',
          ignorePsPricesLock: true,
        });
        reply.send({ ok: true, ...enqueueResult });
        return;
      }

      const enqueueResult = await enqueueDiscoveryEnrichmentRun(backgroundJobs, {
        requestedBy: 'admin-discovery-match',
        igdbGameId: game.igdbGameId,
        platformIgdbId: game.platformIgdbId,
        gameKeys: relatedGames.map(
          (relatedGame) => `${relatedGame.igdbGameId}::${String(relatedGame.platformIgdbId)}`
        ),
        ...(provider !== null ? { providers: [provider] } : {}),
      });

      reply.send({ ok: true, ...toAdminRequeueResult([enqueueResult]) });
    }
  );

  app.post(
    '/v1/admin/discovery/matches/clear-permanent-miss',
    {
      config: {
        rateLimit: MUTATION_RATE_LIMIT,
      },
    },
    async (request, reply) => {
      if (!isAdminAuthorized(request, reply)) {
        return;
      }

      const body = (request.body ?? {}) as ClearPermanentMissBody;
      const provider = parseClearableProvider(body.provider);
      if (!provider) {
        reply.code(400).send({ error: 'Provider must be hltb or review.' });
        return;
      }

      const requestedKeys = parseGameKeys(body.gameKeys);
      const cleared = await withTransaction(pool, async (client) => {
        const rows =
          requestedKeys === null
            ? await listDiscoveryRows(client, null, DISCOVERY_SCAN_LIMIT)
            : await listDiscoveryGamesByKeys(client, requestedKeys);
        let updatedCount = 0;

        for (const row of rows) {
          const nextPayload = structuredClone(row.payload);
          const didReset = resetPermanentMiss(nextPayload, provider);
          if (!didReset) {
            continue;
          }

          const changed = await replaceDiscoveryPayload(
            client,
            row.igdbGameId,
            row.platformIgdbId,
            nextPayload
          );
          if (changed) {
            updatedCount += 1;
          }
        }

        return updatedCount;
      });

      reply.send({
        ok: true,
        provider,
        cleared,
      });
    }
  );
}

async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function enqueueDiscoveryEnrichmentRun(
  backgroundJobs: BackgroundJobRepository,
  params: {
    requestedBy: string;
    igdbGameId?: string;
    platformIgdbId?: number;
    gameKeys?: string[];
    providers?: Array<'hltb' | 'review'>;
  }
): Promise<{ jobId: number; deduped: boolean }> {
  const normalizedGameKeys =
    Array.isArray(params.gameKeys) && params.gameKeys.length > 0
      ? normalizeDiscoveryGameKeys(params.gameKeys)
      : null;
  return backgroundJobs.enqueue({
    jobType: 'discovery_enrichment_run',
    dedupeKey: 'discovery-enrichment:run',
    payload: {
      requestedAt: new Date().toISOString(),
      requestedBy: params.requestedBy,
      ...(normalizedGameKeys !== null ? { gameKeys: normalizedGameKeys } : {}),
      ...(Array.isArray(params.providers) && params.providers.length > 0
        ? { providers: params.providers }
        : {}),
      ...(typeof params.igdbGameId === 'string' ? { igdbGameId: params.igdbGameId } : {}),
      ...(typeof params.platformIgdbId === 'number'
        ? { platformIgdbId: params.platformIgdbId }
        : {}),
    },
    priority: 95,
    maxAttempts: 3,
  });
}

function parseClearableProvider(value: unknown): ClearableDiscoveryMatchProvider | null {
  return value === 'hltb' || value === 'review' ? value : null;
}

function toAdminRequeueResult(
  results: Array<{ jobId: number; deduped: boolean }>
): AdminRequeueResult {
  const queuedCount = results.filter((result) => !result.deduped).length;
  const dedupedCount = results.filter((result) => result.deduped).length;

  return {
    jobId: results[0]?.jobId ?? null,
    queued: queuedCount > 0,
    deduped: queuedCount === 0 && dedupedCount > 0,
    queuedCount,
    dedupedCount,
  };
}

async function enqueuePricingRefreshJobs(
  backgroundJobs: BackgroundJobRepository,
  games: NormalizedDiscoveryGame[],
  params: {
    requestedBy: string;
    ignorePsPricesLock: boolean;
  }
): Promise<AdminRequeueResult> {
  const steamCountry = config.steamDefaultCountry;
  const pspricesRegion = config.pspricesRegionPath.toLowerCase();
  const pspricesShow = config.pspricesShow.toLowerCase();
  const nowMs = Date.now();
  const jobs: Array<() => Promise<{ jobId: number; deduped: boolean }>> = [];

  for (const game of games) {
    const payload = normalizePayloadObject(game.payload);
    if (payload === null) {
      continue;
    }

    if (game.platformIgdbId === STEAM_WINDOWS_PLATFORM_IGDB_ID) {
      const steamAppId = normalizePositiveInteger(payload['steamAppId']);
      if (steamAppId === null) {
        continue;
      }

      jobs.push(() =>
        backgroundJobs.enqueue({
          jobType: 'steam_price_revalidate',
          dedupeKey: `${params.requestedBy}:steam:${game.igdbGameId}:${String(game.platformIgdbId)}:${steamCountry}:${String(steamAppId)}`,
          payload: {
            cacheKey: `${params.requestedBy}:${game.igdbGameId}:${String(game.platformIgdbId)}:${steamCountry}:${String(steamAppId)}`,
            igdbGameId: game.igdbGameId,
            platformIgdbId: game.platformIgdbId,
            cc: steamCountry,
            steamAppId,
          },
          priority: 120,
          maxAttempts: 3,
        })
      );
      continue;
    }

    if (!PSPRICES_PLATFORM_IGDB_IDS.has(game.platformIgdbId)) {
      continue;
    }

    if (!params.ignorePsPricesLock && isProviderMatchLocked(payload, 'psPricesMatchLocked')) {
      continue;
    }

    const pspricesRetryState = maybeRearmProviderRetryState({
      state: parseProviderRetryState(readProviderRetryState(payload, 'psprices')),
      nowMs,
      releaseYear: normalizePositiveInteger(payload['releaseYear']),
      rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
      rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears,
      maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
    });
    if (
      !shouldAttemptProvider({
        state: pspricesRetryState,
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
        dedupeKey: `${params.requestedBy}:psprices:${game.igdbGameId}:${String(game.platformIgdbId)}:${pspricesRegion}:${pspricesShow}`,
        payload: {
          cacheKey: `${params.requestedBy}:${game.igdbGameId}:${String(game.platformIgdbId)}:${pspricesRegion}:${pspricesShow}`,
          igdbGameId: game.igdbGameId,
          platformIgdbId: game.platformIgdbId,
          title,
          psPricesUrl: resolvePreferredPsPricesUrl(payload),
        },
        priority: 120,
        maxAttempts: 3,
      })
    );
  }

  const results = await runWithConcurrencyLimit(jobs, PRICING_REQUEUE_CONCURRENCY);
  return toAdminRequeueResult(results);
}

function buildDetailResponse(
  igdbGameId: string,
  platformIgdbId: number,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return {
    igdbGameId,
    platformIgdbId,
    title: normalizeString(payload['title']),
    platform: normalizeString(payload['platform']),
    releaseYear: normalizePositiveInteger(payload['releaseYear']),
    matchState: buildMatchState(payload, platformIgdbId),
    providers: {
      hltb: {
        hltbGameId: normalizePositiveInteger(payload['hltbMatchGameId']),
        hltbUrl: normalizeString(payload['hltbMatchUrl']),
        hltbMainHours: normalizeNumber(payload['hltbMainHours']),
        hltbMainExtraHours: normalizeNumber(payload['hltbMainExtraHours']),
        hltbCompletionistHours: normalizeNumber(payload['hltbCompletionistHours']),
        queryTitle: normalizeString(payload['hltbMatchQueryTitle']),
        queryReleaseYear: normalizePositiveInteger(payload['hltbMatchQueryReleaseYear']),
        queryPlatform: normalizeString(payload['hltbMatchQueryPlatform']),
      },
      review: {
        reviewSource: parseReviewSource(payload['reviewSource']),
        reviewScore: normalizeNumber(payload['reviewScore']),
        reviewUrl: normalizeString(payload['reviewUrl']),
        metacriticScore: normalizeNumber(payload['metacriticScore']),
        metacriticUrl: normalizeString(payload['metacriticUrl']),
        mobygamesGameId: normalizePositiveInteger(payload['mobygamesGameId']),
        mobyScore: normalizeNumber(payload['mobyScore']),
        queryTitle: normalizeString(payload['reviewMatchQueryTitle']),
        queryReleaseYear: normalizePositiveInteger(payload['reviewMatchQueryReleaseYear']),
        queryPlatform: normalizeString(payload['reviewMatchQueryPlatform']),
        queryPlatformIgdbId: normalizePositiveInteger(payload['reviewMatchPlatformIgdbId']),
        queryMobygamesGameId: normalizePositiveInteger(payload['reviewMatchMobygamesGameId']),
      },
      pricing: {
        priceSource: normalizeString(payload['priceSource']),
        priceFetchedAt: normalizeIsoDate(payload['priceFetchedAt']),
        priceAmount: normalizeNumber(payload['priceAmount']),
        priceCurrency: normalizeString(payload['priceCurrency']),
        priceRegularAmount: normalizeNumber(payload['priceRegularAmount']),
        priceDiscountPercent: normalizeNumber(payload['priceDiscountPercent']),
        priceIsFree: normalizeBoolean(payload['priceIsFree']),
        priceUrl: normalizeString(payload['priceUrl']),
        psPricesUrl: normalizeString(payload['psPricesUrl']),
        psPricesTitle: normalizeString(payload['psPricesTitle']),
        psPricesPlatform: normalizeString(payload['psPricesPlatform']),
      },
    },
  };
}

function mapDiscoveryListItem(row: {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
}): {
  igdbGameId: string;
  platformIgdbId: number;
  title: string | null;
  platform: string | null;
  releaseYear: number | null;
  matchState: Record<DiscoveryMatchProvider, DiscoveryProviderState>;
} {
  return {
    igdbGameId: row.igdbGameId,
    platformIgdbId: row.platformIgdbId,
    title: normalizeString(row.payload['title']),
    platform: normalizeString(row.payload['platform']),
    releaseYear: normalizePositiveInteger(row.payload['releaseYear']),
    matchState: buildMatchState(row.payload, row.platformIgdbId),
  };
}

function buildMatchState(
  payload: Record<string, unknown>,
  platformIgdbId: number
): Record<DiscoveryMatchProvider, DiscoveryProviderState> {
  return {
    hltb: buildHltbState(payload),
    review: buildReviewState(payload),
    pricing: buildPricingState(payload, platformIgdbId),
  };
}

function buildHltbState(payload: Record<string, unknown>): DiscoveryProviderState {
  const retry = parseProviderRetryState(readProviderRetryState(payload, 'hltb'));
  const hasMatch =
    normalizeNumber(payload['hltbMainHours']) !== null ||
    normalizeNumber(payload['hltbMainExtraHours']) !== null ||
    normalizeNumber(payload['hltbCompletionistHours']) !== null;
  return buildProviderState(hasMatch, isProviderMatchLocked(payload, 'hltbMatchLocked'), retry);
}

function buildReviewState(payload: Record<string, unknown>): DiscoveryProviderState {
  const retry = parseProviderRetryState(readProviderRetryState(payload, 'metacritic'));
  const reviewSource = parseReviewSource(payload['reviewSource']);
  const hasMatch =
    (reviewSource !== null && normalizeNumber(payload['reviewScore']) !== null) ||
    normalizeNumber(payload['metacriticScore']) !== null;
  return buildProviderState(hasMatch, isProviderMatchLocked(payload, 'reviewMatchLocked'), retry);
}

function buildPricingState(
  payload: Record<string, unknown>,
  platformIgdbId: number
): DiscoveryProviderState {
  const hasPrice = hasUnifiedPriceValue(payload);
  const isEligiblePlatform = isPricingPlatformEligible(platformIgdbId);
  if (!isEligiblePlatform) {
    return {
      status: 'matched',
      locked: isProviderMatchLocked(payload, 'psPricesMatchLocked'),
      ...createEmptyProviderRetryState(),
    };
  }

  const retry = parseProviderRetryState(readProviderRetryState(payload, 'psprices'));
  return buildProviderState(hasPrice, isProviderMatchLocked(payload, 'psPricesMatchLocked'), retry);
}

function isPricingPlatformEligible(platformIgdbId: number): boolean {
  return (
    platformIgdbId === STEAM_WINDOWS_PLATFORM_IGDB_ID ||
    PSPRICES_PLATFORM_IGDB_IDS.has(platformIgdbId)
  );
}

function getDefaultPricingSource(platformIgdbId: number): 'steam_store' | 'psprices' {
  return platformIgdbId === STEAM_WINDOWS_PLATFORM_IGDB_ID ? 'steam_store' : 'psprices';
}

function buildProviderState(
  hasMatch: boolean,
  locked: boolean,
  retry: ProviderRetryState
): DiscoveryProviderState {
  if (hasMatch) {
    return {
      status: 'matched',
      locked,
      attempts: retry.attempts,
      lastTriedAt: retry.lastTriedAt,
      nextTryAt: retry.nextTryAt,
      permanentMiss: retry.permanentMiss,
    };
  }

  if (retry.permanentMiss) {
    return {
      status: 'permanentMiss',
      locked,
      attempts: retry.attempts,
      lastTriedAt: retry.lastTriedAt,
      nextTryAt: retry.nextTryAt,
      permanentMiss: true,
    };
  }

  if (retry.attempts > 0 || retry.nextTryAt !== null || retry.lastTriedAt !== null) {
    return {
      status: 'retrying',
      locked,
      attempts: retry.attempts,
      lastTriedAt: retry.lastTriedAt,
      nextTryAt: retry.nextTryAt,
      permanentMiss: false,
    };
  }

  return {
    status: 'missing',
    locked,
    attempts: 0,
    lastTriedAt: null,
    nextTryAt: null,
    permanentMiss: false,
  };
}

function matchesListFilter(
  matchState: Record<DiscoveryMatchProvider, DiscoveryProviderState>,
  provider: DiscoveryMatchProvider | null,
  state: DiscoveryMatchStateStatus | 'all'
): boolean {
  const providers: DiscoveryMatchProvider[] = provider ? [provider] : ['hltb', 'review', 'pricing'];
  return providers.some((currentProvider) => {
    const currentState = matchState[currentProvider];
    if (state === 'all') {
      return currentState.status !== 'matched';
    }
    return currentState.status === state;
  });
}

function applyManualMatchPatch(
  payload: Record<string, unknown>,
  platformIgdbId: number,
  provider: DiscoveryMatchProvider,
  body: PatchBody
): string | null {
  if (provider === 'hltb') {
    const integerError =
      validatePositiveIntegerField(body.hltbGameId, 'HLTB game ID') ??
      validatePositiveIntegerField(body.queryReleaseYear, 'Query release year');
    if (integerError) {
      return integerError;
    }

    const hltbGameId = normalizePositiveInteger(body.hltbGameId);
    const hltbUrl = normalizeString(body.hltbUrl);
    const hltbMainHours = normalizeNumber(body.hltbMainHours);
    const hltbMainExtraHours = normalizeNumber(body.hltbMainExtraHours);
    const hltbCompletionistHours = normalizeNumber(body.hltbCompletionistHours);
    const timingError =
      validateNonNegativeNumberField(hltbMainHours, 'HLTB main hours') ??
      validateNonNegativeNumberField(hltbMainExtraHours, 'HLTB main-extra hours') ??
      validateNonNegativeNumberField(hltbCompletionistHours, 'HLTB completionist hours');
    if (timingError) {
      return timingError;
    }
    if (
      hltbGameId === null &&
      hltbUrl === null &&
      hltbMainHours === null &&
      hltbMainExtraHours === null &&
      hltbCompletionistHours === null
    ) {
      return 'HLTB updates require at least one match or timing field.';
    }
    payload['hltbMatchGameId'] = hltbGameId;
    payload['hltbMatchUrl'] = hltbUrl;
    payload['hltbMainHours'] = hltbMainHours;
    payload['hltbMainExtraHours'] = hltbMainExtraHours;
    payload['hltbCompletionistHours'] = hltbCompletionistHours;
    payload['hltbMatchQueryTitle'] = normalizeString(body.queryTitle);
    payload['hltbMatchQueryReleaseYear'] = normalizePositiveInteger(body.queryReleaseYear);
    payload['hltbMatchQueryPlatform'] = normalizeString(body.queryPlatform);
    payload['hltbMatchLocked'] = true;
    resetRetryState(payload, 'hltb');
    return null;
  }

  if (provider === 'review') {
    const integerError =
      validatePositiveIntegerField(body.mobygamesGameId, 'MobyGames game ID') ??
      validatePositiveIntegerField(body.queryReleaseYear, 'Query release year');
    if (integerError) {
      return integerError;
    }

    const reviewScore = normalizeNumber(body.reviewScore);
    const reviewUrl = normalizeString(body.reviewUrl);
    const metacriticScore = normalizeNumber(body.metacriticScore);
    const metacriticUrl = normalizeString(body.metacriticUrl);
    const mobygamesGameId = normalizePositiveInteger(body.mobygamesGameId);
    const mobyScore = normalizeNumber(body.mobyScore);
    const hasReviewFields = reviewScore !== null || reviewUrl !== null;
    const hasMetacriticFields = metacriticScore !== null || metacriticUrl !== null;
    const reviewSource =
      parseReviewSource(body.reviewSource) ?? (hasMetacriticFields ? 'metacritic' : null);
    const scoreError =
      validateBoundedNumberField(reviewScore, 'Review score', 0, 100) ??
      validateBoundedNumberField(metacriticScore, 'Metacritic score', 0, 100) ??
      validateBoundedNumberField(mobyScore, 'MobyGames score', 0, 10);
    if (scoreError) {
      return scoreError;
    }
    if (reviewSource === null && hasReviewFields) {
      return 'Review source is required when review score or review URL is provided.';
    }
    if (
      reviewSource === null &&
      reviewScore === null &&
      reviewUrl === null &&
      metacriticScore === null &&
      metacriticUrl === null &&
      mobygamesGameId === null &&
      mobyScore === null
    ) {
      return 'Review updates require at least one review field.';
    }
    payload['reviewSource'] = reviewSource;
    payload['reviewScore'] = reviewScore;
    payload['reviewUrl'] = reviewUrl ?? metacriticUrl;
    payload['metacriticScore'] =
      reviewSource === 'metacritic' ? (metacriticScore ?? reviewScore) : null;
    payload['metacriticUrl'] = reviewSource === 'metacritic' ? (metacriticUrl ?? reviewUrl) : null;
    payload['mobygamesGameId'] = reviewSource === 'mobygames' ? mobygamesGameId : null;
    payload['mobyScore'] = reviewSource === 'mobygames' ? mobyScore : null;
    payload['reviewMatchQueryTitle'] = normalizeString(body.queryTitle);
    payload['reviewMatchQueryReleaseYear'] = normalizePositiveInteger(body.queryReleaseYear);
    payload['reviewMatchQueryPlatform'] = normalizeString(body.queryPlatform);
    payload['reviewMatchPlatformIgdbId'] = platformIgdbId;
    payload['reviewMatchMobygamesGameId'] = reviewSource === 'mobygames' ? mobygamesGameId : null;
    payload['reviewMatchLocked'] = true;
    resetRetryState(payload, 'metacritic');
    return null;
  }

  const priceAmount = normalizeNumber(body.priceAmount);
  const hasPriceIsFree = Object.prototype.hasOwnProperty.call(body, 'priceIsFree');
  const normalizedPriceIsFree = normalizeBoolean(body.priceIsFree);
  if (hasPriceIsFree && body.priceIsFree !== null && normalizedPriceIsFree === null) {
    return 'Price is free must be true or false.';
  }
  const priceIsFree = hasPriceIsFree
    ? normalizedPriceIsFree
    : normalizeBoolean(payload['priceIsFree']);
  const priceUrl = normalizeString(body.priceUrl) ?? normalizeString(body.psPricesUrl);
  const requestedPriceSource = normalizeString(body.priceSource);
  const priceSource =
    (requestedPriceSource === null
      ? getDefaultPricingSource(platformIgdbId)
      : parsePricingSource(requestedPriceSource)) ?? null;
  if (requestedPriceSource !== null && priceSource === null) {
    return 'Price source must be steam_store or psprices.';
  }
  const isPsPricesSource = priceSource === 'psprices';
  const priceRegularAmount = normalizeNumber(body.priceRegularAmount);
  const priceDiscountPercent = normalizeNumber(body.priceDiscountPercent);
  const pricingError =
    validateNonNegativeNumberField(priceAmount, 'Price amount') ??
    validateNonNegativeNumberField(priceRegularAmount, 'Price regular amount') ??
    validateBoundedNumberField(priceDiscountPercent, 'Price discount percent', 0, 100);
  if (pricingError) {
    return pricingError;
  }
  if (priceAmount === null && priceIsFree !== true && priceUrl === null) {
    return 'Pricing updates require at least one pricing field.';
  }
  payload['priceSource'] = priceSource;
  payload['priceFetchedAt'] = normalizeIsoDate(body.priceFetchedAt) ?? new Date().toISOString();
  payload['priceAmount'] = priceAmount;
  payload['priceCurrency'] = normalizeString(body.priceCurrency);
  payload['priceRegularAmount'] = priceRegularAmount;
  payload['priceDiscountPercent'] = priceDiscountPercent;
  payload['priceIsFree'] = priceIsFree;
  payload['priceUrl'] = priceUrl;
  payload['psPricesUrl'] = isPsPricesSource
    ? (normalizeString(body.psPricesUrl) ?? priceUrl)
    : null;
  payload['psPricesTitle'] = isPsPricesSource ? normalizeString(body.psPricesTitle) : null;
  payload['psPricesPlatform'] = isPsPricesSource ? normalizeString(body.psPricesPlatform) : null;
  payload['psPricesMatchLocked'] = true;
  resetRetryState(payload, 'psprices');
  return null;
}

function clearManualMatch(
  payload: Record<string, unknown>,
  provider: DiscoveryMatchProvider
): void {
  if (provider === 'hltb') {
    payload['hltbMatchGameId'] = null;
    payload['hltbMatchUrl'] = null;
    payload['hltbMainHours'] = null;
    payload['hltbMainExtraHours'] = null;
    payload['hltbCompletionistHours'] = null;
    payload['hltbMatchQueryTitle'] = null;
    payload['hltbMatchQueryReleaseYear'] = null;
    payload['hltbMatchQueryPlatform'] = null;
    payload['hltbMatchLocked'] = false;
    resetRetryState(payload, 'hltb');
    return;
  }

  if (provider === 'review') {
    payload['reviewSource'] = null;
    payload['reviewScore'] = null;
    payload['reviewUrl'] = null;
    payload['metacriticScore'] = null;
    payload['metacriticUrl'] = null;
    payload['mobygamesGameId'] = null;
    payload['mobyScore'] = null;
    payload['reviewMatchQueryTitle'] = null;
    payload['reviewMatchQueryReleaseYear'] = null;
    payload['reviewMatchQueryPlatform'] = null;
    payload['reviewMatchPlatformIgdbId'] = null;
    payload['reviewMatchMobygamesGameId'] = null;
    payload['reviewMatchLocked'] = false;
    resetRetryState(payload, 'metacritic');
    return;
  }

  payload['priceSource'] = null;
  payload['priceFetchedAt'] = null;
  payload['priceAmount'] = null;
  payload['priceCurrency'] = null;
  payload['priceRegularAmount'] = null;
  payload['priceDiscountPercent'] = null;
  payload['priceIsFree'] = null;
  payload['priceUrl'] = null;
  payload['psPricesUrl'] = null;
  payload['psPricesTitle'] = null;
  payload['psPricesPlatform'] = null;
  payload['psPricesMatchLocked'] = false;
  resetRetryState(payload, 'psprices');
}

function resetPermanentMiss(
  payload: Record<string, unknown>,
  provider: 'hltb' | 'review' | 'pricing'
): boolean {
  const retryKey = provider === 'hltb' ? 'hltb' : provider === 'review' ? 'metacritic' : 'psprices';
  const current = parseProviderRetryState(readProviderRetryState(payload, retryKey));
  if (
    !current.permanentMiss &&
    current.attempts === 0 &&
    current.lastTriedAt === null &&
    current.nextTryAt === null
  ) {
    return false;
  }
  resetRetryState(payload, retryKey);
  return true;
}

function resetRetryState(
  payload: Record<string, unknown>,
  providerKey: 'hltb' | 'metacritic' | 'steam' | 'psprices'
): void {
  const existingRetry =
    payload['enrichmentRetry'] &&
    typeof payload['enrichmentRetry'] === 'object' &&
    !Array.isArray(payload['enrichmentRetry'])
      ? ({ ...(payload['enrichmentRetry'] as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  existingRetry[providerKey] = createEmptyProviderRetryState();

  payload['enrichmentRetry'] = existingRetry;
}

async function listDiscoveryRows(
  queryable: Queryable,
  search: string | null,
  limit: number
): Promise<NormalizedDiscoveryGame[]> {
  const normalizedLimit = Math.max(1, Math.min(DISCOVERY_SCAN_LIMIT, limit));
  const result = await queryable.query<DiscoveryGameRow>(
    `
    SELECT igdb_game_id, platform_igdb_id, payload
    FROM games
    WHERE COALESCE(payload->>'listType', '') = 'discovery'
      AND ($1::text IS NULL OR LOWER(COALESCE(payload->>'title', '')) LIKE '%' || $1 || '%')
    ORDER BY updated_at DESC
    LIMIT $2
    `,
    [search, normalizedLimit]
  );

  return result.rows
    .map((row) => ({
      igdbGameId: row.igdb_game_id,
      platformIgdbId: row.platform_igdb_id,
      payload: normalizePayloadObject(row.payload),
    }))
    .filter(
      (
        row
      ): row is { igdbGameId: string; platformIgdbId: number; payload: Record<string, unknown> } =>
        row.payload !== null
    );
}

async function listDiscoveryGamesByKeys(
  queryable: Queryable,
  gameKeys: Set<string>
): Promise<NormalizedDiscoveryGame[]> {
  const parsedKeys = parseDiscoveryGameKeys([...gameKeys]);
  if (parsedKeys.length === 0) {
    return [];
  }

  const result = await queryable.query<DiscoveryGameRow>(
    `
    WITH requested_keys AS (
      SELECT DISTINCT *
      FROM UNNEST($1::text[], $2::integer[]) AS requested(igdb_game_id, platform_igdb_id)
    )
    SELECT igdb_game_id, platform_igdb_id, payload
    FROM games
    INNER JOIN requested_keys USING (igdb_game_id, platform_igdb_id)
    WHERE COALESCE(payload->>'listType', '') = 'discovery'
    ORDER BY updated_at DESC
    `,
    [parsedKeys.map((entry) => entry.igdbGameId), parsedKeys.map((entry) => entry.platformIgdbId)]
  );

  return result.rows
    .map((row) => ({
      igdbGameId: row.igdb_game_id,
      platformIgdbId: row.platform_igdb_id,
      payload: normalizePayloadObject(row.payload),
    }))
    .filter((row): row is NormalizedDiscoveryGame => row.payload !== null);
}

async function runWithConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: T[] = [];
  for (let index = 0; index < tasks.length; index += concurrency) {
    const chunk = tasks.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map((task) => task()))));
  }
  return results;
}

async function listDiscoveryGamesByIgdbGameId(
  queryable: Queryable,
  igdbGameIdRaw: unknown
): Promise<NormalizedDiscoveryGame[]> {
  const igdbGameId = normalizeIdentifier(igdbGameIdRaw);
  if (igdbGameId === null) {
    return [];
  }

  const result = await queryable.query<DiscoveryGameRow>(
    `
    SELECT igdb_game_id, platform_igdb_id, payload
    FROM games
    WHERE igdb_game_id = $1
      AND COALESCE(payload->>'listType', '') = 'discovery'
    ORDER BY platform_igdb_id ASC
    `,
    [igdbGameId]
  );

  return result.rows
    .map((row) => ({
      igdbGameId: row.igdb_game_id,
      platformIgdbId: row.platform_igdb_id,
      payload: normalizePayloadObject(row.payload),
    }))
    .filter((row): row is NormalizedDiscoveryGame => row.payload !== null);
}

async function getDiscoveryGame(
  queryable: Queryable,
  igdbGameIdRaw: unknown,
  platformIgdbIdRaw: unknown
): Promise<{
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
} | null> {
  const igdbGameId = normalizeIdentifier(igdbGameIdRaw);
  const platformIgdbId = normalizePositiveInteger(platformIgdbIdRaw);
  if (igdbGameId === null || platformIgdbId === null) {
    return null;
  }

  const result = await queryable.query<DiscoveryGameRow>(
    `
    SELECT igdb_game_id, platform_igdb_id, payload
    FROM games
    WHERE igdb_game_id = $1
      AND platform_igdb_id = $2
      AND COALESCE(payload->>'listType', '') = 'discovery'
    LIMIT 1
    `,
    [igdbGameId, platformIgdbId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return null;
  }

  const row = result.rows[0];
  const payload = normalizePayloadObject(row.payload);
  if (payload === null) {
    return null;
  }

  return {
    igdbGameId: row.igdb_game_id,
    platformIgdbId: row.platform_igdb_id,
    payload,
  };
}

async function replaceDiscoveryPayload(
  queryable: Queryable,
  igdbGameId: string,
  platformIgdbId: number,
  payload: Record<string, unknown>
): Promise<boolean> {
  const result = await queryable.query(
    `
    WITH current_row AS (
      SELECT payload
      FROM games
      WHERE igdb_game_id = $1
        AND platform_igdb_id = $2
        AND COALESCE(payload->>'listType', '') = 'discovery'
        AND payload IS DISTINCT FROM $3::jsonb
      FOR UPDATE
    )
    UPDATE games AS g
    SET payload = $3::jsonb, updated_at = NOW()
    FROM current_row
    WHERE g.igdb_game_id = $1
      AND g.platform_igdb_id = $2
    `,
    [igdbGameId, platformIgdbId, JSON.stringify(payload)]
  );

  return (result.rowCount ?? 0) > 0;
}

function readProviderRetryState(
  payload: Record<string, unknown>,
  providerKey: 'hltb' | 'metacritic' | 'steam' | 'psprices'
): unknown {
  const retry = payload['enrichmentRetry'];
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) {
    return null;
  }
  return (retry as Record<string, unknown>)[providerKey];
}

function hasUnifiedPriceValue(payload: Record<string, unknown>): boolean {
  if (payload['priceIsFree'] === true) {
    return true;
  }
  const priceAmount = normalizeNumber(payload['priceAmount']);
  return priceAmount !== null && priceAmount >= 0;
}

function parseProvider(value: unknown): DiscoveryMatchProvider | null {
  if (value === 'hltb' || value === 'review' || value === 'pricing') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'hltb' || normalized === 'review' || normalized === 'pricing'
    ? (normalized as DiscoveryMatchProvider)
    : null;
}

function parseRequiredProvider(value: unknown): DiscoveryMatchProvider | null {
  return parseProvider(value);
}

function parseStateFilter(value: unknown): DiscoveryMatchStateStatus | 'all' {
  if (typeof value !== 'string') {
    return 'all';
  }
  const normalized = value.trim();
  return normalized === 'missing' || normalized === 'retrying' || normalized === 'permanentMiss'
    ? (normalized as DiscoveryMatchStateStatus)
    : 'all';
}

function normalizeSearch(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseLimit(value: unknown, fallback: number): number {
  const parsed = normalizePositiveInteger(value);
  if (parsed === null) {
    return fallback;
  }
  return Math.min(MAX_LIST_LIMIT, parsed);
}

function parseGameKeys(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const keys = normalizeDiscoveryGameKeys(
    value.filter((item): item is string => typeof item === 'string')
  );
  return new Set(keys);
}

function normalizePayloadObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!/^-?\d+$/.test(normalized)) {
      return null;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const normalized = normalizeInteger(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateNonNegativeNumberField(value: number | null, label: string): string | null {
  if (value === null) {
    return null;
  }
  return value >= 0 ? null : `${label} must be greater than or equal to 0.`;
}

function validatePositiveIntegerField(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return null;
  }
  return normalizePositiveInteger(value) === null ? `${label} must be a positive integer.` : null;
}

function validateBoundedNumberField(
  value: number | null,
  label: string,
  min: number,
  max: number
): string | null {
  if (value === null) {
    return null;
  }
  if (value < min || value > max) {
    return `${label} must be between ${String(min)} and ${String(max)}.`;
  }
  return null;
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return null;
}

function normalizeIsoDate(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  return Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function parseReviewSource(value: unknown): 'metacritic' | 'mobygames' | null {
  if (value === 'metacritic' || value === 'mobygames') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'metacritic' || normalized === 'mobygames') {
    return normalized;
  }
  return null;
}

function parsePricingSource(value: unknown): 'steam_store' | 'psprices' | null {
  if (value === 'steam_store' || value === 'psprices') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'steam_store' || normalized === 'psprices') {
    return normalized;
  }
  return null;
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
