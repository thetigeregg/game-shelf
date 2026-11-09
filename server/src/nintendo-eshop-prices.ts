import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, QueryResultRow } from 'pg';
import { incrementNintendoEshopPriceMetric } from './cache-metrics.js';
import { config } from './config.js';
import { isDiscoveryListType } from './list-type.js';
import { NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID } from './platform-ids.js';
import {
  buildNintendoEshopGameUrl,
  fetchNintendoEshopGameByNsuid,
  fetchNintendoEshopPrices,
  parseNintendoEshopNsuid,
  resolveNintendoEshopLocale,
  searchNintendoEshopGames,
  type NintendoEshopLocale,
  type NintendoEshopPrice,
  type NintendoEshopSearchGame,
} from './nintendo-eshop-client.js';
import { maybeSendWishlistSaleNotification } from './price-sale-notifications.js';
import { matchCandidatesByTitle, type TitleMatchInfo } from './price-title-matching.js';
import { applyRouteRateLimit, ensureRateLimitRegistered } from './rate-limit.js';
import { CLIENT_WRITE_TOKEN_HEADER_NAME, isAuthorizedMutatingRequest } from './request-security.js';
import {
  hasMeaningfulRetryState,
  maybeRearmProviderRetryState,
  nextProviderRetryState,
  parseProviderRetryState,
  shouldAttemptProvider,
} from './recommendations/provider-retry-state.js';
import { round2 } from './utils/round.js';

interface NintendoEshopPricesRouteOptions {
  fetchImpl?: typeof fetch;
  nowProvider?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: NintendoEshopPriceRevalidationPayload) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

interface GamePayloadRow extends QueryResultRow {
  payload: unknown;
}

type RouteStatus = 'ok' | 'unsupported_platform' | 'unavailable';

/** Same shape as the PlayStation Store price snapshot, with the eShop nsuid as the product. */
export interface NintendoEshopPriceSnapshot {
  title: string | null;
  nsuid: string | null;
  amount: number | null;
  currency: string | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  url: string | null;
  imageUrl?: string | null;
  saleEndsAt?: string | null;
}

interface NintendoEshopCandidate extends NintendoEshopPriceSnapshot {
  score: number;
}

/** A search result as the title matcher sees it. */
interface MatchableGame {
  title: string;
  url: string;
  amount: number | null;
  gameId: null;
  game: NintendoEshopSearchGame;
  price: NintendoEshopPrice | null;
}

interface NintendoEshopRouteResponse {
  status: RouteStatus;
  igdbGameId: string;
  platformIgdbId: number;
  platform: string | null;
  country: string;
  language: string;
  cached: boolean;
  bestPrice: NintendoEshopPriceSnapshot | null;
  match: TitleMatchInfo | null;
  candidates?: NintendoEshopCandidate[];
}

interface CachedSnapshot {
  fetchedAt: string;
  snapshot: NintendoEshopPriceSnapshot;
  match: TitleMatchInfo | null;
  candidates: NintendoEshopCandidate[];
}

interface Lookup {
  snapshot: NintendoEshopPriceSnapshot | null;
  match: TitleMatchInfo;
  /** Undefined when the lookup didn't search (a pinned nsuid was priced directly). */
  candidates?: NintendoEshopCandidate[];
}

export interface NintendoEshopPriceRevalidationPayload extends Record<string, unknown> {
  cacheKey: string;
  igdbGameId: string;
  platformIgdbId: number;
  title?: string | null;
  nsuid?: string | null;
}

/** The search index's code for the platform each Nintendo platform label stands for. */
const PLATFORM_CODE_BY_PLATFORM = new Map<string, string>([
  ['Switch', 'HAC'],
  ['Switch 2', 'BEE'],
]);
const MAX_CANDIDATES = 30;
const DEFAULT_FRESH_TTL_SECONDS = 86400;
const DEFAULT_STALE_TTL_SECONDS = 86400 * 90;
const revalidationInFlightByKey = new Map<string, Promise<void>>();

export async function registerNintendoEshopPricesRoute(
  app: FastifyInstance,
  pool: Pool,
  options: NintendoEshopPricesRouteOptions = {}
): Promise<void> {
  await ensureRateLimitRegistered(app);

  const fetchImpl = options.fetchImpl ?? fetch;
  const nowProvider = options.nowProvider ?? (() => Date.now());
  const scheduleBackgroundRefresh =
    options.scheduleBackgroundRefresh ??
    ((task) => {
      queueMicrotask(() => {
        void task();
      });
    });
  const enableStaleWhileRevalidate =
    options.enableStaleWhileRevalidate ?? config.nintendoEshopPriceCacheEnableStaleWhileRevalidate;
  const freshTtlSeconds = normalizeTtlSeconds(
    options.freshTtlSeconds,
    config.nintendoEshopPriceCacheFreshTtlSeconds,
    DEFAULT_FRESH_TTL_SECONDS
  );
  const staleTtlSeconds = Math.max(
    freshTtlSeconds,
    normalizeTtlSeconds(
      options.staleTtlSeconds,
      config.nintendoEshopPriceCacheStaleTtlSeconds,
      DEFAULT_STALE_TTL_SECONDS
    )
  );

  app.route({
    method: 'GET',
    url: '/v1/nintendo-eshop/prices',
    config: applyRouteRateLimit('nintendo_eshop_prices'),
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const igdbGameId = normalizeGameId(query['igdbGameId']);
      const platformIgdbId = normalizePositiveInteger(query['platformIgdbId']);
      const titleOverride = normalizeNonEmptyString(query['title']);
      const nsuidOverride = parseNintendoEshopNsuid(query['nsuid']);
      const hasTitleOverride = titleOverride !== null;
      const hasLookupOverride = hasTitleOverride || nsuidOverride !== null;
      const includeCandidates = normalizeBooleanQuery(query['includeCandidates']);
      const locale = resolveNintendoEshopLocale();

      if (!igdbGameId || platformIgdbId === null) {
        incrementNintendoEshopPriceMetric('invalidRequests');
        reply.code(400).send({ error: 'igdbGameId and platformIgdbId are required.' });
        return;
      }
      if (query['nsuid'] !== undefined && nsuidOverride === null) {
        incrementNintendoEshopPriceMetric('invalidRequests');
        reply.code(400).send({ error: 'nsuid must be a Nintendo eShop nsuid or eShop link.' });
        return;
      }

      // Saving an override changes the game's price, pinned nsuid and lock, so it needs the same
      // write token as other changes (GET requests are otherwise public). A picker search (an
      // override with includeCandidates) saves nothing and stays public.
      if (
        hasLookupOverride &&
        !includeCandidates &&
        !isAuthorizedMutatingRequest({
          requireAuth: config.requireAuth,
          apiToken: config.apiToken,
          clientWriteTokens: config.clientWriteTokens,
          authorizationHeader: request.headers.authorization,
          clientWriteTokenHeader: request.headers[CLIENT_WRITE_TOKEN_HEADER_NAME.toLowerCase()],
        })
      ) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const baseResponse = (platform: string | null) => ({
        igdbGameId,
        platformIgdbId,
        platform,
        country: locale.country,
        language: locale.language,
      });

      const platform = NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID.get(platformIgdbId) ?? null;
      if (platform === null) {
        const unsupported: NintendoEshopRouteResponse = {
          status: 'unsupported_platform',
          ...baseResponse(null),
          cached: false,
          bestPrice: null,
          match: null,
          ...(includeCandidates ? { candidates: [] } : {}),
        };
        reply.code(200).send(unsupported);
        return;
      }

      let payload: Record<string, unknown> | null = null;
      try {
        payload = await readGamePayload(pool, igdbGameId, platformIgdbId);
      } catch (error) {
        incrementNintendoEshopPriceMetric('readErrors');
        request.log.warn({
          msg: 'nintendo_eshop_prices_read_failed',
          igdbGameId,
          platformIgdbId,
          error: error instanceof Error ? error.message : String(error),
        });
        reply.code(502).send({ error: 'Unable to read game pricing state.' });
        return;
      }
      if (!payload) {
        reply.code(404).send({ error: 'Game not found.' });
        return;
      }

      const title = titleOverride ?? resolveLookupTitle(payload);
      const preferredNsuid =
        nsuidOverride ?? (hasTitleOverride ? null : resolvePinnedNsuid(payload));
      // The saved title belongs to the saved pin; a newly chosen nsuid's title is looked up.
      const preferredTitle = hasLookupOverride ? null : resolvePinnedTitle(payload);
      if (!title) {
        const unavailable: NintendoEshopRouteResponse = {
          status: 'unavailable',
          ...baseResponse(platform),
          cached: false,
          bestPrice: null,
          match: null,
          ...(includeCandidates ? { candidates: [] } : {}),
        };
        reply.code(200).send(unavailable);
        return;
      }

      const cachedSnapshot = hasLookupOverride
        ? null
        : readSnapshotFromPayload(payload, locale, platform);

      // A manual price saved without an nsuid (admin match page) has nothing to refresh
      // from: searching would replace it with whatever the title matches. Serve it as saved.
      if (!hasLookupOverride && isManualPriceLock(payload)) {
        const manual: NintendoEshopRouteResponse = {
          status:
            cachedSnapshot && isAvailableSnapshot(cachedSnapshot.snapshot) ? 'ok' : 'unavailable',
          ...baseResponse(platform),
          cached: true,
          bestPrice: cachedSnapshot?.snapshot ?? null,
          match: cachedSnapshot?.match ?? null,
          ...(includeCandidates ? { candidates: cachedSnapshot?.candidates ?? [] } : {}),
        };
        incrementNintendoEshopPriceMetric('hits');
        reply.header('X-GameShelf-Nintendo-Eshop-Cache', 'LOCKED');
        reply.code(200).send(manual);
        return;
      }

      if (cachedSnapshot) {
        const ageSeconds = getAgeSeconds(cachedSnapshot.fetchedAt, nowProvider());
        const status: RouteStatus = isAvailableSnapshot(cachedSnapshot.snapshot)
          ? 'ok'
          : 'unavailable';
        const cachedResponse: NintendoEshopRouteResponse = {
          status,
          ...baseResponse(platform),
          cached: true,
          bestPrice: cachedSnapshot.snapshot,
          match: cachedSnapshot.match,
          ...(includeCandidates ? { candidates: cachedSnapshot.candidates } : {}),
        };

        if (ageSeconds <= freshTtlSeconds) {
          incrementNintendoEshopPriceMetric('hits');
          reply.header('X-GameShelf-Nintendo-Eshop-Cache', 'HIT_FRESH');
          reply.code(200).send(cachedResponse);
          return;
        }

        if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds) {
          incrementNintendoEshopPriceMetric('hits');
          incrementNintendoEshopPriceMetric('staleServed');
          const scheduled = scheduleNintendoEshopPriceRevalidation({
            cacheKey: buildCacheKey({ igdbGameId, platformIgdbId, locale, platform }),
            request,
            pool,
            payload,
            igdbGameId,
            platformIgdbId,
            title,
            nsuid: preferredNsuid,
            fetchImpl,
            scheduleBackgroundRefresh,
            enqueueRevalidationJob: options.enqueueRevalidationJob,
          });
          reply.header('X-GameShelf-Nintendo-Eshop-Cache', 'HIT_STALE');
          reply.header(
            'X-GameShelf-Nintendo-Eshop-Revalidate',
            scheduled ? 'scheduled' : 'skipped'
          );
          reply.code(200).send(cachedResponse);
          return;
        }
      }

      incrementNintendoEshopPriceMetric('misses');
      try {
        const lookup = await lookupNintendoEshopPrice({
          title,
          platform,
          preferredNsuid,
          preferredTitle,
          // The picker needs the search results, so don't shortcut to the pinned nsuid.
          searchAlways: includeCandidates,
          locale,
          fetchImpl,
        });

        // A picker search (an override that asks for candidates) only shows the results: the
        // price, pin and lock are saved when one is chosen, by a request with its nsuid.
        const isPickerSearch = includeCandidates && hasLookupOverride;
        if (!isPickerSearch) {
          try {
            await persistNintendoEshopSnapshot(pool, {
              igdbGameId,
              platformIgdbId,
              payload,
              locale,
              platform,
              lookup,
              // Lock only a resolved match: a failed override search stays retryable rather than
              // looking like a manual price (locked without an nsuid).
              matchLocked: hasLookupOverride && lookup.snapshot !== null ? true : undefined,
            });
            incrementNintendoEshopPriceMetric('writes');
          } catch (error) {
            incrementNintendoEshopPriceMetric('writeErrors');
            request.log.warn({
              msg: 'nintendo_eshop_prices_write_failed',
              igdbGameId,
              platformIgdbId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const response: NintendoEshopRouteResponse = {
          status: lookup.snapshot ? 'ok' : 'unavailable',
          ...baseResponse(platform),
          cached: false,
          bestPrice: lookup.snapshot,
          match: lookup.match,
          ...(includeCandidates ? { candidates: lookup.candidates ?? [] } : {}),
        };
        reply.header('X-GameShelf-Nintendo-Eshop-Cache', 'MISS');
        reply.code(200).send(response);
      } catch (error) {
        incrementNintendoEshopPriceMetric('upstreamErrors');
        request.log.warn({
          msg: 'nintendo_eshop_prices_fetch_failed',
          igdbGameId,
          platformIgdbId,
          error: error instanceof Error ? error.message : String(error),
        });
        reply.code(502).send({ error: 'Unable to fetch Nintendo eShop prices.' });
      }
    },
  });
}

/**
 * Prices a game on the Nintendo eShop. A pinned nsuid is priced directly; if there is none, or the
 * store no longer sells it, the store's games for this platform are searched by title, priced in
 * one request, and matched with the shared title matcher. Only a confident match that is for sale
 * in the store's country gets a price.
 */
export async function lookupNintendoEshopPrice(params: {
  title: string;
  platform: string;
  preferredNsuid: string | null;
  /** The pinned game's saved title, if known; otherwise it is looked up with the nsuid. */
  preferredTitle?: string | null;
  searchAlways?: boolean;
  locale: NintendoEshopLocale;
  fetchImpl: typeof fetch;
}): Promise<Lookup> {
  const requestOptions = { locale: params.locale, fetchImpl: params.fetchImpl };
  const platformCode = PLATFORM_CODE_BY_PLATFORM.get(params.platform);
  if (!platformCode) {
    throw new Error(`Unsupported Nintendo eShop platform: ${params.platform}`);
  }

  if (params.preferredNsuid && params.searchAlways !== true) {
    const nsuid = params.preferredNsuid;
    const price = (await fetchNintendoEshopPrices([nsuid], requestOptions)).get(nsuid);
    if (price) {
      const game = params.preferredTitle
        ? null
        : await fetchNintendoEshopGameByNsuid(nsuid, requestOptions);
      const title = params.preferredTitle ?? game?.title ?? null;
      return {
        snapshot: toSnapshot({ nsuid, title, imageUrl: game?.imageUrl }, price, params.locale),
        match: { queryTitle: params.title, matchedTitle: title, score: null, confidence: 'high' },
      };
    }
  }

  const games = await searchNintendoEshopGames(params.title, platformCode, {
    ...requestOptions,
    rows: MAX_CANDIDATES,
  });
  // The search index's prices are another country's, so every result is priced here; one that
  // isn't for sale in this country (unreleased, or not sold there) has no price.
  const prices =
    games.length > 0
      ? await fetchNintendoEshopPrices(
          games.map((game) => game.nsuid),
          requestOptions
        )
      : new Map<string, NintendoEshopPrice>();
  const matchable: MatchableGame[] = games.map((game) => {
    const price = prices.get(game.nsuid) ?? null;
    return {
      title: game.title,
      url: buildNintendoEshopGameUrl(game.nsuid, params.locale),
      amount: price?.amount ?? null,
      gameId: null,
      game,
      price,
    };
  });
  const result = matchCandidatesByTitle(params.title, params.platform, matchable, {
    isPreferred: params.preferredNsuid
      ? (candidate) => candidate.game.nsuid === params.preferredNsuid
      : undefined,
    maxCandidates: MAX_CANDIDATES,
  });
  // The picker only offers games with a price: choosing one without would save nothing.
  const candidates = result.candidates
    .filter((candidate) => candidate.price !== null)
    .map((candidate) => ({
      ...toSnapshot(candidate.game, candidate.price, params.locale),
      score: candidate.score,
    }));
  if (!result.best) {
    return { snapshot: null, match: result.match, candidates };
  }
  // Matched, but not for sale here: no price to save, as for a PlayStation Store product that
  // isn't sold. The candidates still go to the picker.
  if (!result.best.price) {
    return { snapshot: null, match: { ...result.match, confidence: 'low' }, candidates };
  }
  return {
    snapshot: toSnapshot(result.best.game, result.best.price, params.locale),
    match: result.match,
    candidates,
  };
}

function toSnapshot(
  game: { nsuid: string; title: string | null; imageUrl?: string | null },
  price: NintendoEshopPrice | null,
  locale: NintendoEshopLocale
): NintendoEshopPriceSnapshot {
  return {
    title: game.title,
    nsuid: game.nsuid,
    amount: price?.amount ?? null,
    currency: price?.currency ?? null,
    regularAmount: price?.regularAmount ?? null,
    discountPercent: price?.discountPercent ?? null,
    isFree: price ? price.isFree : null,
    url: buildNintendoEshopGameUrl(game.nsuid, locale),
    ...(game.imageUrl !== undefined ? { imageUrl: game.imageUrl } : {}),
    saleEndsAt: price?.saleEndsAt ?? null,
  };
}

function resolveLookupTitle(payload: Record<string, unknown>): string | null {
  return (
    normalizeNonEmptyString(payload['nintendoEshopMatchQueryTitle']) ??
    normalizeNonEmptyString(payload['title'])
  );
}

/** A match locked without an nsuid: a manual price, which refreshes leave alone. */
export function isManualPriceLock(payload: Record<string, unknown>): boolean {
  return (
    payload['nintendoEshopMatchLocked'] === true &&
    resolvePinnedNsuid(payload) === null &&
    (typeof payload['nintendoEshopPriceAmount'] === 'number' ||
      payload['nintendoEshopIsFree'] === true)
  );
}

export type NintendoEshopRefreshJob =
  | {
      kind: 'enqueue';
      dedupeKey: string;
      payload: NintendoEshopPriceRevalidationPayload;
    }
  | { kind: 'skip'; reason: 'unsupported-platform' | 'backoff' | 'manual-price' | 'missing-data' };

/**
 * The refresh job for a Switch/Switch 2 game, shared by the pricing worker and the admin refresh
 * routes. Discovery games back off after failed lookups (enrichmentRetry.nintendoEshop); a manual
 * price (locked without an nsuid) isn't refreshed. Callers that honour the full match lock check it
 * themselves.
 */
export function buildNintendoEshopRefreshJob(params: {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
  dedupePrefix: string;
  nowMs?: number;
}): NintendoEshopRefreshJob {
  if (!NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID.has(params.platformIgdbId)) {
    return { kind: 'skip', reason: 'unsupported-platform' };
  }
  if (isManualPriceLock(params.payload)) {
    return { kind: 'skip', reason: 'manual-price' };
  }
  if (!isRetryDue(params.payload, params.nowMs ?? Date.now())) {
    return { kind: 'skip', reason: 'backoff' };
  }
  const title = resolveLookupTitle(params.payload);
  if (!title) {
    return { kind: 'skip', reason: 'missing-data' };
  }

  const locale = resolveNintendoEshopLocale();
  const scope = `${params.igdbGameId}:${String(params.platformIgdbId)}:${locale.country.toLowerCase()}:${locale.language.toLowerCase()}`;
  return {
    kind: 'enqueue',
    dedupeKey: `${params.dedupePrefix}:nintendo-eshop:${scope}`,
    payload: {
      cacheKey: `${params.dedupePrefix}:${scope}`,
      igdbGameId: params.igdbGameId,
      platformIgdbId: params.platformIgdbId,
      title,
      nsuid: resolvePinnedNsuid(params.payload),
    },
  };
}

function readRetryState(payload: Record<string, unknown>): unknown {
  const retry = payload['enrichmentRetry'];
  return retry && typeof retry === 'object' && !Array.isArray(retry)
    ? (retry as Record<string, unknown>)['nintendoEshop']
    : null;
}

function readReleaseYear(payload: Record<string, unknown>): number | null {
  const value = payload['releaseYear'];
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  return typeof value === 'string' && /^\d{4}$/.test(value.trim())
    ? Number.parseInt(value.trim(), 10)
    : null;
}

/** Only discovery games track retries; others are always due. */
function isRetryDue(payload: Record<string, unknown>, nowMs: number): boolean {
  if (!isDiscoveryListType(payload['listType'])) {
    return true;
  }
  const state = maybeRearmProviderRetryState({
    state: parseProviderRetryState(readRetryState(payload)),
    nowMs,
    releaseYear: readReleaseYear(payload),
    rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
    rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears,
    maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
  });
  return shouldAttemptProvider({
    state,
    nowMs,
    maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
  });
}

function resolvePinnedNsuid(payload: Record<string, unknown>): string | null {
  return parseNintendoEshopNsuid(payload['nintendoEshopNsuid']);
}

/** The title saved with the pinned nsuid, so refreshing a pin needs no title lookup. */
function resolvePinnedTitle(payload: Record<string, unknown>): string | null {
  return resolvePinnedNsuid(payload)
    ? normalizeNonEmptyString(payload['nintendoEshopTitle'])
    : null;
}

async function readGamePayload(
  pool: Pool,
  igdbGameId: string,
  platformIgdbId: number
): Promise<Record<string, unknown> | null> {
  const row = await pool.query<GamePayloadRow>(
    'SELECT payload FROM games WHERE igdb_game_id = $1 AND platform_igdb_id = $2 LIMIT 1',
    [igdbGameId, platformIgdbId]
  );
  return normalizePayloadObject(row.rows[0]?.payload);
}

function buildCacheKey(params: {
  igdbGameId: string;
  platformIgdbId: number;
  locale: NintendoEshopLocale;
  platform: string;
}): string {
  return [
    params.igdbGameId,
    String(params.platformIgdbId),
    params.locale.country.toLowerCase(),
    params.locale.language.toLowerCase(),
    params.platform.toLowerCase(),
  ].join(':');
}

function readSnapshotFromPayload(
  payload: Record<string, unknown>,
  locale: NintendoEshopLocale,
  platform: string
): CachedSnapshot | null {
  const fetchedAt = normalizeNonEmptyString(payload['nintendoEshopFetchedAt']);
  if (
    !fetchedAt ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    normalizeNonEmptyString(payload['nintendoEshopCountry']) !== locale.country ||
    normalizeNonEmptyString(payload['nintendoEshopLanguage']) !== locale.language ||
    normalizeNonEmptyString(payload['nintendoEshopPlatform']) !== platform
  ) {
    return null;
  }

  const matchQueryTitle = normalizeNonEmptyString(payload['nintendoEshopMatchQueryTitle']);
  const matchConfidence = normalizeConfidence(payload['nintendoEshopMatchConfidence']);
  const candidatesRaw = Array.isArray(payload['nintendoEshopCandidates'])
    ? (payload['nintendoEshopCandidates'] as unknown[])
    : [];

  return {
    fetchedAt,
    snapshot: {
      title: normalizeNonEmptyString(payload['nintendoEshopTitle']),
      nsuid: normalizeNonEmptyString(payload['nintendoEshopNsuid']),
      amount: normalizeNumberOrNull(payload['nintendoEshopPriceAmount']),
      currency: normalizeNonEmptyString(payload['nintendoEshopPriceCurrency']),
      regularAmount: normalizeNumberOrNull(payload['nintendoEshopRegularPriceAmount']),
      discountPercent: normalizeNumberOrNull(payload['nintendoEshopDiscountPercent']),
      isFree: normalizeBooleanOrNull(payload['nintendoEshopIsFree']),
      url: normalizeNonEmptyString(payload['nintendoEshopUrl']),
      imageUrl: normalizeNonEmptyString(payload['nintendoEshopImageUrl']),
      saleEndsAt: normalizeNonEmptyString(payload['nintendoEshopSaleEndsAt']),
    },
    match:
      matchQueryTitle && matchConfidence
        ? {
            queryTitle: matchQueryTitle,
            matchedTitle: normalizeNonEmptyString(payload['nintendoEshopMatchTitle']),
            score: normalizeNumberOrNull(payload['nintendoEshopMatchScore']),
            confidence: matchConfidence,
          }
        : null,
    candidates: candidatesRaw
      .map((entry) => normalizeCachedCandidate(entry))
      .filter((entry): entry is NintendoEshopCandidate => entry !== null)
      .slice(0, MAX_CANDIDATES),
  };
}

function normalizeCachedCandidate(value: unknown): NintendoEshopCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title = normalizeNonEmptyString(record['title']);
  const amount = normalizeNumberOrNull(record['amount']);
  const isFree = normalizeBooleanOrNull(record['isFree']);
  if (!title || (amount === null && isFree !== true)) {
    return null;
  }
  return {
    title,
    nsuid: normalizeNonEmptyString(record['nsuid']),
    amount,
    currency: normalizeNonEmptyString(record['currency']),
    regularAmount: normalizeNumberOrNull(record['regularAmount']),
    discountPercent: normalizeNumberOrNull(record['discountPercent']),
    isFree,
    url: normalizeNonEmptyString(record['url']),
    imageUrl: normalizeNonEmptyString(record['imageUrl']),
    score: round2(normalizeNumberOrNull(record['score']) ?? 0),
  };
}

function isAvailableSnapshot(snapshot: NintendoEshopPriceSnapshot): boolean {
  return snapshot.amount !== null || snapshot.isFree === true;
}

function scheduleNintendoEshopPriceRevalidation(params: {
  cacheKey: string;
  request: FastifyRequest;
  pool: Pool;
  payload: Record<string, unknown>;
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  nsuid: string | null;
  fetchImpl: typeof fetch;
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: NintendoEshopPriceRevalidationPayload) => void;
}): boolean {
  const revalidationPayload: NintendoEshopPriceRevalidationPayload = {
    cacheKey: params.cacheKey,
    igdbGameId: params.igdbGameId,
    platformIgdbId: params.platformIgdbId,
    title: params.title,
    nsuid: params.nsuid,
  };

  if (params.enqueueRevalidationJob) {
    incrementNintendoEshopPriceMetric('revalidateScheduled');
    params.enqueueRevalidationJob(revalidationPayload);
    return true;
  }

  if (revalidationInFlightByKey.has(params.cacheKey)) {
    incrementNintendoEshopPriceMetric('revalidateSkipped');
    return false;
  }

  incrementNintendoEshopPriceMetric('revalidateScheduled');
  let resolveDone: (() => void) | null = null;
  revalidationInFlightByKey.set(
    params.cacheKey,
    new Promise<void>((resolve) => {
      resolveDone = resolve;
    })
  );

  params.scheduleBackgroundRefresh(async () => {
    try {
      const platform = NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID.get(params.platformIgdbId);
      if (!platform) {
        throw new Error('Unsupported Nintendo eShop platform for revalidation.');
      }
      const locale = resolveNintendoEshopLocale();
      const lookup = await lookupNintendoEshopPrice({
        title: params.title,
        platform,
        preferredNsuid: params.nsuid,
        preferredTitle: resolvePinnedTitle(params.payload),
        locale,
        fetchImpl: params.fetchImpl,
      });
      await persistNintendoEshopSnapshot(params.pool, {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        payload: params.payload,
        locale,
        platform,
        lookup,
      });
      incrementNintendoEshopPriceMetric('writes');
      incrementNintendoEshopPriceMetric('revalidateSucceeded');
    } catch (error) {
      incrementNintendoEshopPriceMetric('revalidateFailed');
      params.request.log.warn({
        msg: 'nintendo_eshop_prices_revalidate_failed',
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      revalidationInFlightByKey.delete(params.cacheKey);
      resolveDone?.();
    }
  });

  return true;
}

async function persistNintendoEshopSnapshot(
  pool: Pool,
  params: {
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
    locale: NintendoEshopLocale;
    platform: string;
    lookup: Lookup;
    matchLocked?: boolean;
    retryState?: unknown;
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const { snapshot, match, candidates } = params.lookup;
  const patchPayload: Record<string, unknown> = {
    nintendoEshopFetchedAt: fetchedAt,
    nintendoEshopSource: 'nintendo_eshop',
    nintendoEshopCountry: params.locale.country,
    nintendoEshopLanguage: params.locale.language,
    nintendoEshopPlatform: params.platform,
    nintendoEshopMatchQueryTitle: match.queryTitle,
    nintendoEshopMatchTitle: match.matchedTitle,
    nintendoEshopMatchScore: match.score,
    nintendoEshopMatchConfidence: match.confidence,
  };
  if (candidates !== undefined) {
    patchPayload['nintendoEshopCandidates'] = candidates
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => ({
        title: candidate.title,
        nsuid: candidate.nsuid,
        amount: candidate.amount,
        currency: candidate.currency,
        regularAmount: candidate.regularAmount,
        discountPercent: candidate.discountPercent,
        isFree: candidate.isFree,
        url: candidate.url,
        imageUrl: candidate.imageUrl ?? null,
        score: candidate.score,
      }));
  }
  if (typeof params.matchLocked === 'boolean') {
    patchPayload['nintendoEshopMatchLocked'] = params.matchLocked;
  }
  if (params.retryState !== undefined) {
    const existingRetry =
      params.payload['enrichmentRetry'] &&
      typeof params.payload['enrichmentRetry'] === 'object' &&
      !Array.isArray(params.payload['enrichmentRetry'])
        ? { ...(params.payload['enrichmentRetry'] as Record<string, unknown>) }
        : {};
    const parsedRetryState = parseProviderRetryState(params.retryState);
    if (hasMeaningfulRetryState(parsedRetryState)) {
      existingRetry['nintendoEshop'] = parsedRetryState;
    } else {
      delete existingRetry['nintendoEshop'];
    }
    patchPayload['enrichmentRetry'] = Object.keys(existingRetry).length > 0 ? existingRetry : null;
  }
  if (snapshot === null) {
    // Nothing for sale matched, so the store's cached price (e.g. a delisted pinned game) is
    // no longer current and mustn't be served as a fresh hit. The pin stays.
    for (const key of [
      'nintendoEshopPriceAmount',
      'nintendoEshopRegularPriceAmount',
      'nintendoEshopDiscountPercent',
      'nintendoEshopIsFree',
      'nintendoEshopSaleEndsAt',
    ]) {
      patchPayload[key] = null;
    }
    // A price this source set is kept (a transient miss); one left over from psprices, which no
    // longer prices Switch/Switch 2, would never update again, so it's cleared now the store has looked.
    if (params.payload['priceSource'] === 'psprices') {
      for (const key of [
        'priceSource',
        'priceFetchedAt',
        'priceAmount',
        'priceCurrency',
        'priceRegularAmount',
        'priceDiscountPercent',
        'priceIsFree',
        'priceUrl',
        'psPricesUrl',
        'psPricesTitle',
        'psPricesPlatform',
        'psPricesMatchLocked',
      ]) {
        patchPayload[key] = null;
      }
    }
  } else {
    patchPayload['priceSource'] = 'nintendo_eshop';
    patchPayload['priceFetchedAt'] = fetchedAt;
    patchPayload['priceAmount'] = snapshot.amount;
    patchPayload['priceCurrency'] = snapshot.currency ?? null;
    patchPayload['priceRegularAmount'] = snapshot.regularAmount ?? null;
    patchPayload['priceDiscountPercent'] = snapshot.discountPercent ?? null;
    patchPayload['priceIsFree'] = snapshot.isFree ?? null;
    patchPayload['priceUrl'] = snapshot.url ?? null;
    patchPayload['nintendoEshopNsuid'] = snapshot.nsuid;
    patchPayload['nintendoEshopTitle'] = snapshot.title ?? null;
    patchPayload['nintendoEshopUrl'] = snapshot.url ?? null;
    patchPayload['nintendoEshopPriceAmount'] = snapshot.amount;
    patchPayload['nintendoEshopPriceCurrency'] = snapshot.currency ?? null;
    patchPayload['nintendoEshopRegularPriceAmount'] = snapshot.regularAmount ?? null;
    patchPayload['nintendoEshopDiscountPercent'] = snapshot.discountPercent ?? null;
    patchPayload['nintendoEshopIsFree'] = snapshot.isFree ?? null;
    patchPayload['nintendoEshopSaleEndsAt'] = snapshot.saleEndsAt ?? null;
    if (snapshot.imageUrl !== undefined) {
      patchPayload['nintendoEshopImageUrl'] = snapshot.imageUrl;
    }
    // Switch/Switch 2 games used to be priced by psprices: drop its pin and lock now that the store has
    // taken over, as the Steam source does.
    patchPayload['psPricesUrl'] = null;
    patchPayload['psPricesTitle'] = null;
    patchPayload['psPricesPlatform'] = null;
    patchPayload['psPricesMatchLocked'] = null;
  }

  const updateResult = await pool.query<{ previous_payload: unknown; next_payload: unknown }>(
    `
      WITH current_row AS (
        SELECT payload
        FROM games
        WHERE igdb_game_id = $1
          AND platform_igdb_id = $2
          AND payload IS DISTINCT FROM (payload || $3::jsonb)
        FOR UPDATE
      )
      UPDATE games AS g
      SET payload = g.payload || $3::jsonb, updated_at = NOW()
      FROM current_row
      WHERE g.igdb_game_id = $1
        AND g.platform_igdb_id = $2
      RETURNING current_row.payload AS previous_payload, g.payload AS next_payload
    `,
    [params.igdbGameId, params.platformIgdbId, JSON.stringify(patchPayload)]
  );

  const previousPayload =
    normalizePayloadObject(updateResult.rows[0]?.previous_payload) ?? params.payload;
  const updatedPayload =
    normalizePayloadObject(updateResult.rows[0]?.next_payload) ?? params.payload;
  const hasChanges = (updateResult.rowCount ?? updateResult.rows.length) > 0;
  if (hasChanges && !isDiscoveryListType(updatedPayload['listType'])) {
    await pool.query(
      `
      INSERT INTO sync_events (entity_type, entity_key, operation, payload, server_timestamp)
      VALUES ('game', $1, 'upsert', $2::jsonb, NOW())
      `,
      [`${params.igdbGameId}::${String(params.platformIgdbId)}`, JSON.stringify(updatedPayload)]
    );
  }

  if (hasChanges) {
    try {
      await maybeSendWishlistSaleNotification(pool, {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        previousPayload,
        nextPayload: updatedPayload,
      });
    } catch (error) {
      console.error('[nintendo-eshop] wishlist_sale_notification_failed', {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function processQueuedNintendoEshopPriceRevalidation(
  pool: Pool,
  payload: NintendoEshopPriceRevalidationPayload,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const igdbGameId = normalizeGameId(payload.igdbGameId);
  const platformIgdbId = normalizePositiveInteger(payload.platformIgdbId);
  if (!igdbGameId || platformIgdbId === null) {
    throw new Error('Invalid Nintendo eShop price revalidation payload.');
  }
  const platform = NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID.get(platformIgdbId);
  if (!platform) {
    throw new Error('Unsupported Nintendo eShop platform for revalidation.');
  }

  const gamePayload = await readGamePayload(pool, igdbGameId, platformIgdbId);
  if (!gamePayload) {
    throw new Error('Nintendo eShop revalidation game row not found.');
  }
  if (isManualPriceLock(gamePayload)) {
    return; // A manual price: nothing to refresh it from.
  }
  // The row as it is now decides, not what was captured when the job was queued: an admin may have
  // replaced or cleared the match since.
  const title = resolveLookupTitle(gamePayload) ?? normalizeNonEmptyString(payload.title);
  if (!title) {
    throw new Error('Nintendo eShop revalidation missing title.');
  }
  const nsuid = resolvePinnedNsuid(gamePayload);
  const locale = resolveNintendoEshopLocale();
  const lookup = await lookupNintendoEshopPrice({
    title,
    platform,
    preferredNsuid: nsuid,
    preferredTitle: resolvePinnedTitle(gamePayload),
    locale,
    fetchImpl: options.fetchImpl ?? fetch,
  });

  const isDiscoveryGame = isDiscoveryListType(gamePayload['listType']);
  const retryState = isDiscoveryGame
    ? nextProviderRetryState({
        current: maybeRearmProviderRetryState({
          state: parseProviderRetryState(
            gamePayload['enrichmentRetry'] &&
              typeof gamePayload['enrichmentRetry'] === 'object' &&
              !Array.isArray(gamePayload['enrichmentRetry'])
              ? (gamePayload['enrichmentRetry'] as Record<string, unknown>)['nintendoEshop']
              : null
          ),
          nowMs: Date.now(),
          releaseYear:
            typeof gamePayload['releaseYear'] === 'number' &&
            Number.isInteger(gamePayload['releaseYear'])
              ? gamePayload['releaseYear']
              : null,
          rearmAfterDays: config.recommendationsDiscoveryEnrichRearmAfterDays,
          rearmRecentReleaseYears: config.recommendationsDiscoveryEnrichRearmRecentReleaseYears,
          maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
        }),
        nowIso: new Date().toISOString(),
        success: lookup.snapshot !== null,
        maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
        backoffBaseMinutes: config.recommendationsDiscoveryEnrichBackoffBaseMinutes,
        backoffMaxHours: config.recommendationsDiscoveryEnrichBackoffMaxHours,
      })
    : null;

  await persistNintendoEshopSnapshot(pool, {
    igdbGameId,
    platformIgdbId,
    payload: gamePayload,
    locale,
    platform,
    lookup,
    retryState: isDiscoveryGame ? retryState : undefined,
  });
}

function normalizeConfidence(value: unknown): TitleMatchInfo['confidence'] | null {
  return value === 'high' || value === 'low' || value === 'none' ? value : null;
}

function normalizePayloadObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeGameId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeBooleanQuery(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeTtlSeconds(
  input: number | undefined,
  configured: number,
  fallback: number
): number {
  if (Number.isInteger(input) && (input as number) > 0) {
    return input as number;
  }
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  return fallback;
}

function getAgeSeconds(updatedAt: string, nowMs: number): number {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (nowMs - updatedMs) / 1000);
}

/**
 * Payload fields that make a manually saved Nintendo eShop price the cached snapshot, so the
 * route serves it rather than an older store lookup. Used by the admin match page.
 */
export function buildManualNintendoEshopSnapshot(params: {
  platformIgdbId: number;
  nsuid: string | null;
  title: string | null;
  url: string | null;
  amount: number | null;
  currency: string | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  fetchedAt: string;
}): Record<string, unknown> {
  const locale = resolveNintendoEshopLocale();
  return {
    nintendoEshopFetchedAt: params.fetchedAt,
    nintendoEshopSource: 'nintendo_eshop',
    nintendoEshopCountry: locale.country,
    nintendoEshopLanguage: locale.language,
    nintendoEshopPlatform: NINTENDO_ESHOP_PLATFORM_BY_IGDB_ID.get(params.platformIgdbId) ?? null,
    nintendoEshopNsuid: params.nsuid,
    nintendoEshopTitle: params.title,
    nintendoEshopUrl: params.url,
    nintendoEshopPriceAmount: params.amount,
    nintendoEshopPriceCurrency: params.currency,
    nintendoEshopRegularPriceAmount: params.regularAmount,
    nintendoEshopDiscountPercent: params.discountPercent,
    nintendoEshopIsFree: params.isFree,
    nintendoEshopSaleEndsAt: null,
    nintendoEshopMatchTitle: params.title,
    nintendoEshopMatchScore: null,
    nintendoEshopMatchConfidence: 'high',
  };
}

export const __nintendoEshopPriceTestables = {
  readSnapshotFromPayload,
  buildCacheKey,
  scheduleNintendoEshopPriceRevalidation,
};
