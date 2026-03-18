import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, QueryResultRow } from 'pg';
import { BackgroundJobRepository } from './background-jobs.js';
import { config } from './config.js';
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
type DiscoveryMatchStateStatus = 'matched' | 'missing' | 'retrying' | 'permanentMiss';

interface DiscoveryGameRow extends QueryResultRow {
  igdb_game_id: string;
  platform_igdb_id: number;
  payload: unknown;
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

      const game = await getDiscoveryGame(pool, params.igdbGameId, params.platformIgdbId);
      if (!game) {
        reply.code(404).send({ error: 'Discovery game not found.' });
        return;
      }

      const relatedGames = await listDiscoveryGamesByIgdbGameId(pool, game.igdbGameId);
      const nextPayload = structuredClone(game.payload);
      const error = applyManualMatchPatch(nextPayload, game.platformIgdbId, provider, body);
      if (error) {
        reply.code(400).send({ error });
        return;
      }

      let changed = false;
      for (const relatedGame of relatedGames) {
        const relatedPayload = structuredClone(relatedGame.payload);
        applyManualMatchPatch(relatedPayload, relatedGame.platformIgdbId, provider, body);
        const didChange = await replaceDiscoveryPayload(
          pool,
          relatedGame.igdbGameId,
          relatedGame.platformIgdbId,
          relatedPayload
        );
        changed = changed || didChange;
      }

      reply.send({
        ok: true,
        changed,
        provider,
        item: buildDetailResponse(game.igdbGameId, game.platformIgdbId, nextPayload),
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

      const game = await getDiscoveryGame(pool, params.igdbGameId, params.platformIgdbId);
      if (!game) {
        reply.code(404).send({ error: 'Discovery game not found.' });
        return;
      }

      const relatedGames = await listDiscoveryGamesByIgdbGameId(pool, game.igdbGameId);
      const nextPayload = structuredClone(game.payload);
      clearManualMatch(nextPayload, provider);
      let changed = false;
      for (const relatedGame of relatedGames) {
        const relatedPayload = structuredClone(relatedGame.payload);
        clearManualMatch(relatedPayload, provider);
        const didChange = await replaceDiscoveryPayload(
          pool,
          relatedGame.igdbGameId,
          relatedGame.platformIgdbId,
          relatedPayload
        );
        changed = changed || didChange;
      }

      reply.send({
        ok: true,
        changed,
        provider,
        item: buildDetailResponse(game.igdbGameId, game.platformIgdbId, nextPayload),
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
      const provider = parseRequiredProvider(body.provider);
      if (!provider) {
        reply.code(400).send({ error: 'Provider must be hltb, review, or pricing.' });
        return;
      }

      const requestedKeys = parseGameKeys(body.gameKeys);
      const rows = await listDiscoveryRows(pool, null, DISCOVERY_SCAN_LIMIT);
      let cleared = 0;

      for (const row of rows) {
        const payload = normalizePayloadObject(row.payload);
        if (!payload) {
          continue;
        }

        const gameKey = `${row.igdbGameId}::${String(row.platformIgdbId)}`;
        if (requestedKeys !== null && !requestedKeys.has(gameKey)) {
          continue;
        }

        const nextPayload = structuredClone(payload);
        const didReset = resetPermanentMiss(nextPayload, provider);
        if (!didReset) {
          continue;
        }

        const changed = await replaceDiscoveryPayload(
          pool,
          row.igdbGameId,
          row.platformIgdbId,
          nextPayload
        );
        if (changed) {
          cleared += 1;
        }
      }

      reply.send({
        ok: true,
        provider,
        cleared,
      });
    }
  );
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
      ? [...new Set(params.gameKeys.map((key) => key.trim()).filter((key) => key.length > 0))]
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
  const results: Array<{ jobId: number; deduped: boolean }> = [];
  const steamCountry = config.steamDefaultCountry;
  const pspricesRegion = config.pspricesRegionPath.toLowerCase();
  const pspricesShow = config.pspricesShow.toLowerCase();

  for (const game of games) {
    const payload = normalizePayloadObject(game.payload);
    if (payload === null) {
      continue;
    }

    if (game.platformIgdbId === 6) {
      const steamAppId = normalizeInteger(payload['steamAppId']);
      if (steamAppId === null) {
        continue;
      }

      results.push(
        await backgroundJobs.enqueue({
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

    if (![48, 167, 130, 508].includes(game.platformIgdbId)) {
      continue;
    }

    if (!params.ignorePsPricesLock && isProviderMatchLocked(payload, 'psPricesMatchLocked')) {
      continue;
    }

    const pspricesRetryState = maybeRearmProviderRetryState({
      state: parseProviderRetryState(readProviderRetryState(payload, 'psprices')),
      nowMs: Date.now(),
      releaseYear: normalizeInteger(payload['releaseYear']),
      rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
      rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears,
      maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
    });
    if (
      !shouldAttemptProvider({
        state: pspricesRetryState,
        nowMs: Date.now(),
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

    results.push(
      await backgroundJobs.enqueue({
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
    releaseYear: normalizeInteger(payload['releaseYear']),
    matchState: buildMatchState(payload, platformIgdbId),
    providers: {
      hltb: {
        hltbGameId: normalizeInteger(payload['hltbMatchGameId']),
        hltbUrl: normalizeString(payload['hltbMatchUrl']),
        hltbMainHours: normalizeNumber(payload['hltbMainHours']),
        hltbMainExtraHours: normalizeNumber(payload['hltbMainExtraHours']),
        hltbCompletionistHours: normalizeNumber(payload['hltbCompletionistHours']),
        queryTitle: normalizeString(payload['hltbMatchQueryTitle']),
        queryReleaseYear: normalizeInteger(payload['hltbMatchQueryReleaseYear']),
        queryPlatform: normalizeString(payload['hltbMatchQueryPlatform']),
      },
      review: {
        reviewSource: parseReviewSource(payload['reviewSource']),
        reviewScore: normalizeNumber(payload['reviewScore']),
        reviewUrl: normalizeString(payload['reviewUrl']),
        metacriticScore: normalizeNumber(payload['metacriticScore']),
        metacriticUrl: normalizeString(payload['metacriticUrl']),
        mobygamesGameId: normalizeInteger(payload['mobygamesGameId']),
        mobyScore: normalizeNumber(payload['mobyScore']),
        queryTitle: normalizeString(payload['reviewMatchQueryTitle']),
        queryReleaseYear: normalizeInteger(payload['reviewMatchQueryReleaseYear']),
        queryPlatform: normalizeString(payload['reviewMatchQueryPlatform']),
        queryPlatformIgdbId: normalizeInteger(payload['reviewMatchPlatformIgdbId']),
        queryMobygamesGameId: normalizeInteger(payload['reviewMatchMobygamesGameId']),
      },
      pricing: {
        priceSource: normalizeString(payload['priceSource']),
        priceFetchedAt: normalizeIsoDate(payload['priceFetchedAt']),
        priceAmount: normalizeNumber(payload['priceAmount']),
        priceCurrency: normalizeString(payload['priceCurrency']),
        priceRegularAmount: normalizeNumber(payload['priceRegularAmount']),
        priceDiscountPercent: normalizeNumber(payload['priceDiscountPercent']),
        priceIsFree: payload['priceIsFree'] === true,
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
    releaseYear: normalizeInteger(row.payload['releaseYear']),
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
    const hltbGameId = normalizeInteger(body.hltbGameId);
    const hltbUrl = normalizeString(body.hltbUrl);
    const hltbMainHours = normalizeNumber(body.hltbMainHours);
    const hltbMainExtraHours = normalizeNumber(body.hltbMainExtraHours);
    const hltbCompletionistHours = normalizeNumber(body.hltbCompletionistHours);
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
    payload['hltbMatchQueryReleaseYear'] = normalizeInteger(body.queryReleaseYear);
    payload['hltbMatchQueryPlatform'] = normalizeString(body.queryPlatform);
    payload['hltbMatchLocked'] = true;
    resetRetryState(payload, 'hltb');
    return null;
  }

  if (provider === 'review') {
    const reviewSource = parseReviewSource(body.reviewSource);
    const reviewScore = normalizeNumber(body.reviewScore);
    const reviewUrl = normalizeString(body.reviewUrl);
    const metacriticScore = normalizeNumber(body.metacriticScore);
    const metacriticUrl = normalizeString(body.metacriticUrl);
    const mobygamesGameId = normalizeInteger(body.mobygamesGameId);
    const mobyScore = normalizeNumber(body.mobyScore);
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
    payload['mobyScore'] = reviewSource === 'mobygames' ? (mobyScore ?? reviewScore) : null;
    payload['reviewMatchQueryTitle'] = normalizeString(body.queryTitle);
    payload['reviewMatchQueryReleaseYear'] = normalizeInteger(body.queryReleaseYear);
    payload['reviewMatchQueryPlatform'] = normalizeString(body.queryPlatform);
    payload['reviewMatchPlatformIgdbId'] = platformIgdbId;
    payload['reviewMatchMobygamesGameId'] = reviewSource === 'mobygames' ? mobygamesGameId : null;
    payload['reviewMatchLocked'] = true;
    resetRetryState(payload, 'metacritic');
    return null;
  }

  const priceAmount = normalizeNumber(body.priceAmount);
  const priceIsFree = normalizeBoolean(body.priceIsFree);
  const priceUrl = normalizeString(body.priceUrl) ?? normalizeString(body.psPricesUrl);
  const priceSource = normalizeString(body.priceSource) ?? 'psprices';
  const isPsPricesSource = priceSource === 'psprices';
  if (priceAmount === null && priceIsFree === null && priceUrl === null) {
    return 'Pricing updates require at least one pricing field.';
  }
  payload['priceSource'] = priceSource;
  payload['priceFetchedAt'] = normalizeIsoDate(body.priceFetchedAt) ?? new Date().toISOString();
  payload['priceAmount'] = priceAmount;
  payload['priceCurrency'] = normalizeString(body.priceCurrency);
  payload['priceRegularAmount'] = normalizeNumber(body.priceRegularAmount);
  payload['priceDiscountPercent'] = normalizeNumber(body.priceDiscountPercent);
  payload['priceIsFree'] = priceIsFree;
  payload['priceUrl'] = priceUrl;
  payload['psPricesUrl'] = isPsPricesSource
    ? (normalizeString(body.psPricesUrl) ?? priceUrl)
    : null;
  payload['psPricesTitle'] = isPsPricesSource ? normalizeString(body.psPricesTitle) : null;
  payload['psPricesPlatform'] = isPsPricesSource ? normalizeString(body.psPricesPlatform) : null;
  payload['psPricesMatchLocked'] = true;
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
  pool: Pool,
  search: string | null,
  limit: number
): Promise<NormalizedDiscoveryGame[]> {
  const normalizedLimit = Math.max(1, Math.min(DISCOVERY_SCAN_LIMIT, limit));
  const result = await pool.query<DiscoveryGameRow>(
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
  pool: Pool,
  gameKeys: Set<string>
): Promise<NormalizedDiscoveryGame[]> {
  const rows = await listDiscoveryRows(pool, null, DISCOVERY_SCAN_LIMIT);
  return rows.filter((row) => gameKeys.has(`${row.igdbGameId}::${String(row.platformIgdbId)}`));
}

async function listDiscoveryGamesByIgdbGameId(
  pool: Pool,
  igdbGameIdRaw: unknown
): Promise<NormalizedDiscoveryGame[]> {
  const igdbGameId = normalizeIdentifier(igdbGameIdRaw);
  if (igdbGameId === null) {
    return [];
  }

  const result = await pool.query<DiscoveryGameRow>(
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
  pool: Pool,
  igdbGameIdRaw: unknown,
  platformIgdbIdRaw: unknown
): Promise<{
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
} | null> {
  const igdbGameId = normalizeIdentifier(igdbGameIdRaw);
  const platformIgdbId = normalizeInteger(platformIgdbIdRaw);
  if (igdbGameId === null || platformIgdbId === null) {
    return null;
  }

  const result = await pool.query<DiscoveryGameRow>(
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
  pool: Pool,
  igdbGameId: string,
  platformIgdbId: number,
  payload: Record<string, unknown>
): Promise<boolean> {
  const result = await pool.query(
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
  return normalizeNumber(payload['priceAmount']) !== null;
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
  return normalized === 'missing' ||
    normalized === 'retrying' ||
    normalized === 'permanentMiss' ||
    normalized === 'matched'
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
  const parsed = normalizeInteger(value);
  if (parsed === null || parsed <= 0) {
    return fallback;
  }
  return Math.min(MAX_LIST_LIMIT, parsed);
}

function parseGameKeys(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const keys = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
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
