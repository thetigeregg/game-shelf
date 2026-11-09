import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, QueryResultRow } from 'pg';
import { incrementPlayStationStorePriceMetric } from './cache-metrics.js';
import { config } from './config.js';
import { isDiscoveryListType } from './list-type.js';
import { PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID } from './platform-ids.js';
import {
  buildPlayStationStoreProductUrl,
  fetchPlayStationStoreProductPrice,
  parsePlayStationStoreProductId,
  resolvePlayStationStoreLocale,
  searchPlayStationStoreProducts,
  type PlayStationStoreLocale,
  type PlayStationStoreSearchProduct,
} from './playstation-store-client.js';
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

interface PlayStationStorePricesRouteOptions {
  fetchImpl?: typeof fetch;
  nowProvider?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: PlayStationStorePriceRevalidationPayload) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

interface GamePayloadRow extends QueryResultRow {
  payload: unknown;
}

type RouteStatus = 'ok' | 'unsupported_platform' | 'unavailable';

/** Same shape as the psprices price snapshot, plus the store product and sale end. */
export interface PlayStationStorePriceSnapshot {
  title: string | null;
  productId: string | null;
  amount: number | null;
  currency: string | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  url: string | null;
  imageUrl?: string | null;
  saleEndsAt?: string | null;
}

interface PlayStationStoreCandidate extends PlayStationStorePriceSnapshot {
  score: number;
}

/** A search result as the title matcher sees it. */
interface MatchableProduct {
  title: string;
  url: string;
  amount: number | null;
  gameId: null;
  metadataQualityScore: number;
  product: PlayStationStoreSearchProduct;
}

interface PlayStationStoreRouteResponse {
  status: RouteStatus;
  igdbGameId: string;
  platformIgdbId: number;
  platform: string | null;
  country: string;
  language: string;
  cached: boolean;
  bestPrice: PlayStationStorePriceSnapshot | null;
  match: TitleMatchInfo | null;
  candidates?: PlayStationStoreCandidate[];
}

interface CachedSnapshot {
  fetchedAt: string;
  snapshot: PlayStationStorePriceSnapshot;
  match: TitleMatchInfo | null;
  candidates: PlayStationStoreCandidate[];
}

interface Lookup {
  snapshot: PlayStationStorePriceSnapshot | null;
  match: TitleMatchInfo;
  /** Undefined when the lookup didn't search (a pinned product was priced directly). */
  candidates?: PlayStationStoreCandidate[];
}

export interface PlayStationStorePriceRevalidationPayload extends Record<string, unknown> {
  cacheKey: string;
  igdbGameId: string;
  platformIgdbId: number;
  title?: string | null;
  productId?: string | null;
}

/** Products that are a game (or an edition of one), not add-ons, demos or currency. */
const GAME_CLASSIFICATIONS = new Set(['FULL_GAME', 'PREMIUM_EDITION', 'GAME_BUNDLE']);
const MAX_CANDIDATES = 30;
const DEFAULT_FRESH_TTL_SECONDS = 86400;
const DEFAULT_STALE_TTL_SECONDS = 86400 * 90;
const CURRENCY_BY_COUNTRY = new Map<string, string>([
  ['CH', 'CHF'],
  ['US', 'USD'],
  ['GB', 'GBP'],
  ['JP', 'JPY'],
  ['KR', 'KRW'],
  ['CA', 'CAD'],
  ['AU', 'AUD'],
  ['DE', 'EUR'],
  ['AT', 'EUR'],
  ['FR', 'EUR'],
  ['IT', 'EUR'],
  ['ES', 'EUR'],
  ['NL', 'EUR'],
  ['BE', 'EUR'],
]);
const revalidationInFlightByKey = new Map<string, Promise<void>>();

export async function registerPlayStationStorePricesRoute(
  app: FastifyInstance,
  pool: Pool,
  options: PlayStationStorePricesRouteOptions = {}
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
    options.enableStaleWhileRevalidate ??
    config.playstationStorePriceCacheEnableStaleWhileRevalidate;
  const freshTtlSeconds = normalizeTtlSeconds(
    options.freshTtlSeconds,
    config.playstationStorePriceCacheFreshTtlSeconds,
    DEFAULT_FRESH_TTL_SECONDS
  );
  const staleTtlSeconds = Math.max(
    freshTtlSeconds,
    normalizeTtlSeconds(
      options.staleTtlSeconds,
      config.playstationStorePriceCacheStaleTtlSeconds,
      DEFAULT_STALE_TTL_SECONDS
    )
  );

  app.route({
    method: 'GET',
    url: '/v1/playstation-store/prices',
    config: applyRouteRateLimit('playstation_store_prices'),
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const igdbGameId = normalizeGameId(query['igdbGameId']);
      const platformIgdbId = normalizePositiveInteger(query['platformIgdbId']);
      const titleOverride = normalizeNonEmptyString(query['title']);
      const productIdOverride = parsePlayStationStoreProductId(query['productId']);
      const hasTitleOverride = titleOverride !== null;
      const hasLookupOverride = hasTitleOverride || productIdOverride !== null;
      const includeCandidates = normalizeBooleanQuery(query['includeCandidates']);
      const locale = resolvePlayStationStoreLocale();

      if (!igdbGameId || platformIgdbId === null) {
        incrementPlayStationStorePriceMetric('invalidRequests');
        reply.code(400).send({ error: 'igdbGameId and platformIgdbId are required.' });
        return;
      }
      if (query['productId'] !== undefined && productIdOverride === null) {
        incrementPlayStationStorePriceMetric('invalidRequests');
        reply
          .code(400)
          .send({ error: 'productId must be a PlayStation Store product ID or product URL.' });
        return;
      }

      // Saving an override changes the game's price, pinned product and lock, so it needs the same
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

      const platform = PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID.get(platformIgdbId) ?? null;
      if (platform === null) {
        const unsupported: PlayStationStoreRouteResponse = {
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
        incrementPlayStationStorePriceMetric('readErrors');
        request.log.warn({
          msg: 'playstation_store_prices_read_failed',
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
      const preferredProductId =
        productIdOverride ?? (hasTitleOverride ? null : resolvePinnedProductId(payload));
      if (!title) {
        const unavailable: PlayStationStoreRouteResponse = {
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

      // A manual price saved without a store product (admin match page) has nothing to refresh
      // from: searching would replace it with whatever the title matches. Serve it as saved.
      if (!hasLookupOverride && isManualPriceLock(payload)) {
        const manual: PlayStationStoreRouteResponse = {
          status:
            cachedSnapshot && isAvailableSnapshot(cachedSnapshot.snapshot) ? 'ok' : 'unavailable',
          ...baseResponse(platform),
          cached: true,
          bestPrice: cachedSnapshot?.snapshot ?? null,
          match: cachedSnapshot?.match ?? null,
          ...(includeCandidates ? { candidates: cachedSnapshot?.candidates ?? [] } : {}),
        };
        incrementPlayStationStorePriceMetric('hits');
        reply.header('X-GameShelf-PlayStation-Store-Cache', 'LOCKED');
        reply.code(200).send(manual);
        return;
      }

      if (cachedSnapshot) {
        const ageSeconds = getAgeSeconds(cachedSnapshot.fetchedAt, nowProvider());
        const status: RouteStatus = isAvailableSnapshot(cachedSnapshot.snapshot)
          ? 'ok'
          : 'unavailable';
        const cachedResponse: PlayStationStoreRouteResponse = {
          status,
          ...baseResponse(platform),
          cached: true,
          bestPrice: cachedSnapshot.snapshot,
          match: cachedSnapshot.match,
          ...(includeCandidates ? { candidates: cachedSnapshot.candidates } : {}),
        };

        if (ageSeconds <= freshTtlSeconds) {
          incrementPlayStationStorePriceMetric('hits');
          reply.header('X-GameShelf-PlayStation-Store-Cache', 'HIT_FRESH');
          reply.code(200).send(cachedResponse);
          return;
        }

        if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds) {
          incrementPlayStationStorePriceMetric('hits');
          incrementPlayStationStorePriceMetric('staleServed');
          const scheduled = schedulePlayStationStorePriceRevalidation({
            cacheKey: buildCacheKey({ igdbGameId, platformIgdbId, locale, platform }),
            request,
            pool,
            payload,
            igdbGameId,
            platformIgdbId,
            title,
            productId: preferredProductId,
            fetchImpl,
            scheduleBackgroundRefresh,
            enqueueRevalidationJob: options.enqueueRevalidationJob,
          });
          reply.header('X-GameShelf-PlayStation-Store-Cache', 'HIT_STALE');
          reply.header(
            'X-GameShelf-PlayStation-Store-Revalidate',
            scheduled ? 'scheduled' : 'skipped'
          );
          reply.code(200).send(cachedResponse);
          return;
        }
      }

      incrementPlayStationStorePriceMetric('misses');
      try {
        const lookup = await lookupPlayStationStorePrice({
          title,
          platform,
          preferredProductId,
          // The picker needs the search results, so don't shortcut to the pinned product.
          searchAlways: includeCandidates,
          locale,
          fetchImpl,
        });

        // A picker search (an override that asks for candidates) only shows the results: the
        // price, pin and lock are saved when one is chosen, by a request with its product.
        const isPickerSearch = includeCandidates && hasLookupOverride;
        if (!isPickerSearch) {
          try {
            await persistPlayStationStoreSnapshot(pool, {
              igdbGameId,
              platformIgdbId,
              payload,
              locale,
              platform,
              lookup,
              // Lock only a resolved match: a failed override search stays retryable rather than
              // looking like a manual price (locked without a product).
              matchLocked: hasLookupOverride && lookup.snapshot !== null ? true : undefined,
            });
            incrementPlayStationStorePriceMetric('writes');
          } catch (error) {
            incrementPlayStationStorePriceMetric('writeErrors');
            request.log.warn({
              msg: 'playstation_store_prices_write_failed',
              igdbGameId,
              platformIgdbId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const response: PlayStationStoreRouteResponse = {
          status: lookup.snapshot ? 'ok' : 'unavailable',
          ...baseResponse(platform),
          cached: false,
          bestPrice: lookup.snapshot,
          match: lookup.match,
          ...(includeCandidates ? { candidates: lookup.candidates ?? [] } : {}),
        };
        reply.header('X-GameShelf-PlayStation-Store-Cache', 'MISS');
        reply.code(200).send(response);
      } catch (error) {
        incrementPlayStationStorePriceMetric('upstreamErrors');
        request.log.warn({
          msg: 'playstation_store_prices_fetch_failed',
          igdbGameId,
          platformIgdbId,
          error: error instanceof Error ? error.message : String(error),
        });
        reply.code(502).send({ error: 'Unable to fetch PlayStation Store prices.' });
      }
    },
  });
}

/**
 * Prices a game on the PlayStation Store. A pinned product is priced directly (one request); if
 * there is none, or the store no longer sells it, the store is searched by title and the results
 * that are a game for this platform are matched with the shared title matcher. Only a confident
 * match is priced, using the product's exact price rather than the search result's display string.
 */
export async function lookupPlayStationStorePrice(params: {
  title: string;
  platform: string;
  preferredProductId: string | null;
  searchAlways?: boolean;
  locale: PlayStationStoreLocale;
  fetchImpl: typeof fetch;
}): Promise<Lookup> {
  const requestOptions = { locale: params.locale, fetchImpl: params.fetchImpl };

  if (params.preferredProductId && params.searchAlways !== true) {
    const price = await fetchPlayStationStoreProductPrice(
      params.preferredProductId,
      requestOptions
    );
    if (price) {
      return {
        snapshot: {
          title: price.name,
          productId: price.productId,
          amount: price.amount,
          currency: price.currency ?? currencyForCountry(params.locale.country),
          regularAmount: price.regularAmount,
          discountPercent: price.discountPercent,
          isFree: price.isFree,
          url: buildPlayStationStoreProductUrl(price.productId, params.locale),
          saleEndsAt: price.saleEndsAt,
        },
        match: {
          queryTitle: params.title,
          matchedTitle: price.name,
          score: null,
          confidence: 'high',
        },
      };
    }
  }

  const products = await searchPlayStationStoreProducts(params.title, requestOptions);
  const matchable = products
    .filter((product) => isPricedGameForPlatform(product, params.platform))
    .map((product) => toMatchableProduct(product, params.platform, params.locale));
  const result = matchCandidatesByTitle(params.title, params.platform, matchable, {
    isPreferred: params.preferredProductId
      ? (candidate) => candidate.product.productId === params.preferredProductId
      : undefined,
    maxCandidates: MAX_CANDIDATES,
  });
  const candidates = result.candidates.map((candidate) => ({
    ...toSnapshot(candidate.product, params.locale),
    score: candidate.score,
  }));
  if (!result.best) {
    return { snapshot: null, match: result.match, candidates };
  }

  // The search result's price is a parsed display string; the product lookup has exact cents and
  // the sale end. It returns nothing when the product isn't for sale to everyone (delisted, or a
  // subscription price only), and then there's no price to save: the candidates still go to the
  // picker.
  const bestProduct = result.best.product;
  const exact = await fetchPlayStationStoreProductPrice(bestProduct.productId, requestOptions);
  if (!exact) {
    return { snapshot: null, match: { ...result.match, confidence: 'low' }, candidates };
  }
  const searchSnapshot = toSnapshot(bestProduct, params.locale);
  const snapshot: PlayStationStorePriceSnapshot = {
    ...searchSnapshot,
    amount: exact.amount,
    currency: exact.currency ?? searchSnapshot.currency,
    regularAmount: exact.regularAmount,
    discountPercent: exact.discountPercent,
    isFree: exact.isFree,
    saleEndsAt: exact.saleEndsAt,
  };
  return { snapshot, match: result.match, candidates };
}

function isPricedGameForPlatform(
  product: PlayStationStoreSearchProduct,
  platform: string
): boolean {
  return (
    product.platforms.includes(platform) &&
    product.classification !== null &&
    GAME_CLASSIFICATIONS.has(product.classification) &&
    (product.amount !== null || product.isFree)
  );
}

function toMatchableProduct(
  product: PlayStationStoreSearchProduct,
  platform: string,
  locale: PlayStationStoreLocale
): MatchableProduct {
  // Breaks ties between same-named products: a full game over a bundle, and a product for just
  // this platform over a cross-buy one.
  let quality = 0;
  if (product.classification === 'FULL_GAME') {
    quality += 2;
  }
  if (product.platforms.length === 1 && product.platforms[0] === platform) {
    quality += 1;
  }
  return {
    title: product.name,
    url: buildPlayStationStoreProductUrl(product.productId, locale),
    amount: product.amount,
    gameId: null,
    metadataQualityScore: quality,
    product,
  };
}

function toSnapshot(
  product: PlayStationStoreSearchProduct,
  locale: PlayStationStoreLocale
): PlayStationStorePriceSnapshot {
  return {
    title: product.name,
    productId: product.productId,
    amount: product.amount,
    currency: product.currency ?? currencyForCountry(locale.country),
    regularAmount: product.regularAmount,
    discountPercent: product.discountPercent,
    isFree: product.isFree,
    url: buildPlayStationStoreProductUrl(product.productId, locale),
    imageUrl: product.imageUrl,
    saleEndsAt: null,
  };
}

function currencyForCountry(country: string): string | null {
  return CURRENCY_BY_COUNTRY.get(country.toUpperCase()) ?? null;
}

function resolveLookupTitle(payload: Record<string, unknown>): string | null {
  return (
    normalizeNonEmptyString(payload['playstationStoreMatchQueryTitle']) ??
    normalizeNonEmptyString(payload['title'])
  );
}

/** A match locked without a store product: a manual price, which refreshes leave alone. */
export function isManualPriceLock(payload: Record<string, unknown>): boolean {
  return (
    payload['playstationStoreMatchLocked'] === true &&
    resolvePinnedProductId(payload) === null &&
    (typeof payload['playstationStorePriceAmount'] === 'number' ||
      payload['playstationStoreIsFree'] === true)
  );
}

export type PlayStationStoreRefreshJob =
  | {
      kind: 'enqueue';
      dedupeKey: string;
      payload: PlayStationStorePriceRevalidationPayload;
    }
  | { kind: 'skip'; reason: 'unsupported-platform' | 'backoff' | 'manual-price' | 'missing-data' };

/**
 * The refresh job for a PS4/PS5 game, shared by the pricing worker and the admin refresh routes.
 * Discovery games back off after failed lookups (enrichmentRetry.playstationStore); a manual price
 * (locked without a product) isn't refreshed. Callers that honour the full match lock check it
 * themselves.
 */
export function buildPlayStationStoreRefreshJob(params: {
  igdbGameId: string;
  platformIgdbId: number;
  payload: Record<string, unknown>;
  dedupePrefix: string;
  nowMs?: number;
}): PlayStationStoreRefreshJob {
  if (!PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID.has(params.platformIgdbId)) {
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

  const locale = resolvePlayStationStoreLocale();
  const scope = `${params.igdbGameId}:${String(params.platformIgdbId)}:${locale.country.toLowerCase()}:${locale.language.toLowerCase()}`;
  return {
    kind: 'enqueue',
    dedupeKey: `${params.dedupePrefix}:playstation-store:${scope}`,
    payload: {
      cacheKey: `${params.dedupePrefix}:${scope}`,
      igdbGameId: params.igdbGameId,
      platformIgdbId: params.platformIgdbId,
      title,
      productId: resolvePinnedProductId(params.payload),
    },
  };
}

function readRetryState(payload: Record<string, unknown>): unknown {
  const retry = payload['enrichmentRetry'];
  return retry && typeof retry === 'object' && !Array.isArray(retry)
    ? (retry as Record<string, unknown>)['playstationStore']
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

function resolvePinnedProductId(payload: Record<string, unknown>): string | null {
  return parsePlayStationStoreProductId(payload['playstationStoreProductId']);
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
  locale: PlayStationStoreLocale;
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
  locale: PlayStationStoreLocale,
  platform: string
): CachedSnapshot | null {
  const fetchedAt = normalizeNonEmptyString(payload['playstationStoreFetchedAt']);
  if (
    !fetchedAt ||
    !Number.isFinite(Date.parse(fetchedAt)) ||
    normalizeNonEmptyString(payload['playstationStoreCountry']) !== locale.country ||
    normalizeNonEmptyString(payload['playstationStoreLanguage']) !== locale.language ||
    normalizeNonEmptyString(payload['playstationStorePlatform']) !== platform
  ) {
    return null;
  }

  const matchQueryTitle = normalizeNonEmptyString(payload['playstationStoreMatchQueryTitle']);
  const matchConfidence = normalizeConfidence(payload['playstationStoreMatchConfidence']);
  const candidatesRaw = Array.isArray(payload['playstationStoreCandidates'])
    ? (payload['playstationStoreCandidates'] as unknown[])
    : [];

  return {
    fetchedAt,
    snapshot: {
      title: normalizeNonEmptyString(payload['playstationStoreTitle']),
      productId: normalizeNonEmptyString(payload['playstationStoreProductId']),
      amount: normalizeNumberOrNull(payload['playstationStorePriceAmount']),
      currency: normalizeNonEmptyString(payload['playstationStorePriceCurrency']),
      regularAmount: normalizeNumberOrNull(payload['playstationStoreRegularPriceAmount']),
      discountPercent: normalizeNumberOrNull(payload['playstationStoreDiscountPercent']),
      isFree: normalizeBooleanOrNull(payload['playstationStoreIsFree']),
      url: normalizeNonEmptyString(payload['playstationStoreUrl']),
      imageUrl: normalizeNonEmptyString(payload['playstationStoreImageUrl']),
      saleEndsAt: normalizeNonEmptyString(payload['playstationStoreSaleEndsAt']),
    },
    match:
      matchQueryTitle && matchConfidence
        ? {
            queryTitle: matchQueryTitle,
            matchedTitle: normalizeNonEmptyString(payload['playstationStoreMatchTitle']),
            score: normalizeNumberOrNull(payload['playstationStoreMatchScore']),
            confidence: matchConfidence,
          }
        : null,
    candidates: candidatesRaw
      .map((entry) => normalizeCachedCandidate(entry))
      .filter((entry): entry is PlayStationStoreCandidate => entry !== null)
      .slice(0, MAX_CANDIDATES),
  };
}

function normalizeCachedCandidate(value: unknown): PlayStationStoreCandidate | null {
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
    productId: normalizeNonEmptyString(record['productId']),
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

function isAvailableSnapshot(snapshot: PlayStationStorePriceSnapshot): boolean {
  return snapshot.amount !== null || snapshot.isFree === true;
}

function schedulePlayStationStorePriceRevalidation(params: {
  cacheKey: string;
  request: FastifyRequest;
  pool: Pool;
  payload: Record<string, unknown>;
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  productId: string | null;
  fetchImpl: typeof fetch;
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: PlayStationStorePriceRevalidationPayload) => void;
}): boolean {
  const revalidationPayload: PlayStationStorePriceRevalidationPayload = {
    cacheKey: params.cacheKey,
    igdbGameId: params.igdbGameId,
    platformIgdbId: params.platformIgdbId,
    title: params.title,
    productId: params.productId,
  };

  if (params.enqueueRevalidationJob) {
    incrementPlayStationStorePriceMetric('revalidateScheduled');
    params.enqueueRevalidationJob(revalidationPayload);
    return true;
  }

  if (revalidationInFlightByKey.has(params.cacheKey)) {
    incrementPlayStationStorePriceMetric('revalidateSkipped');
    return false;
  }

  incrementPlayStationStorePriceMetric('revalidateScheduled');
  let resolveDone: (() => void) | null = null;
  revalidationInFlightByKey.set(
    params.cacheKey,
    new Promise<void>((resolve) => {
      resolveDone = resolve;
    })
  );

  params.scheduleBackgroundRefresh(async () => {
    try {
      const platform = PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID.get(params.platformIgdbId);
      if (!platform) {
        throw new Error('Unsupported PlayStation Store platform for revalidation.');
      }
      const locale = resolvePlayStationStoreLocale();
      const lookup = await lookupPlayStationStorePrice({
        title: params.title,
        platform,
        preferredProductId: params.productId,
        locale,
        fetchImpl: params.fetchImpl,
      });
      await persistPlayStationStoreSnapshot(params.pool, {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        payload: params.payload,
        locale,
        platform,
        lookup,
      });
      incrementPlayStationStorePriceMetric('writes');
      incrementPlayStationStorePriceMetric('revalidateSucceeded');
    } catch (error) {
      incrementPlayStationStorePriceMetric('revalidateFailed');
      params.request.log.warn({
        msg: 'playstation_store_prices_revalidate_failed',
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

async function persistPlayStationStoreSnapshot(
  pool: Pool,
  params: {
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
    locale: PlayStationStoreLocale;
    platform: string;
    lookup: Lookup;
    matchLocked?: boolean;
    retryState?: unknown;
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const { snapshot, match, candidates } = params.lookup;
  const patchPayload: Record<string, unknown> = {
    playstationStoreFetchedAt: fetchedAt,
    playstationStoreSource: 'playstation_store',
    playstationStoreCountry: params.locale.country,
    playstationStoreLanguage: params.locale.language,
    playstationStorePlatform: params.platform,
    playstationStoreMatchQueryTitle: match.queryTitle,
    playstationStoreMatchTitle: match.matchedTitle,
    playstationStoreMatchScore: match.score,
    playstationStoreMatchConfidence: match.confidence,
  };
  if (candidates !== undefined) {
    patchPayload['playstationStoreCandidates'] = candidates
      .slice(0, MAX_CANDIDATES)
      .map((candidate) => ({
        title: candidate.title,
        productId: candidate.productId,
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
    patchPayload['playstationStoreMatchLocked'] = params.matchLocked;
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
      existingRetry['playstationStore'] = parsedRetryState;
    } else {
      delete existingRetry['playstationStore'];
    }
    patchPayload['enrichmentRetry'] = Object.keys(existingRetry).length > 0 ? existingRetry : null;
  }
  if (snapshot === null) {
    // Nothing for sale matched, so the store's cached price (e.g. a delisted pinned product) is
    // no longer current and mustn't be served as a fresh hit. The pin stays.
    for (const key of [
      'playstationStorePriceAmount',
      'playstationStoreRegularPriceAmount',
      'playstationStoreDiscountPercent',
      'playstationStoreIsFree',
      'playstationStoreSaleEndsAt',
    ]) {
      patchPayload[key] = null;
    }
    // A price this source set is kept (a transient miss); one left over from psprices, which no
    // longer prices PS4/PS5, would never update again, so it's cleared now the store has looked.
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
    patchPayload['priceSource'] = 'playstation_store';
    patchPayload['priceFetchedAt'] = fetchedAt;
    patchPayload['priceAmount'] = snapshot.amount;
    patchPayload['priceCurrency'] = snapshot.currency ?? null;
    patchPayload['priceRegularAmount'] = snapshot.regularAmount ?? null;
    patchPayload['priceDiscountPercent'] = snapshot.discountPercent ?? null;
    patchPayload['priceIsFree'] = snapshot.isFree ?? null;
    patchPayload['priceUrl'] = snapshot.url ?? null;
    patchPayload['playstationStoreProductId'] = snapshot.productId;
    patchPayload['playstationStoreTitle'] = snapshot.title ?? null;
    patchPayload['playstationStoreUrl'] = snapshot.url ?? null;
    patchPayload['playstationStorePriceAmount'] = snapshot.amount;
    patchPayload['playstationStorePriceCurrency'] = snapshot.currency ?? null;
    patchPayload['playstationStoreRegularPriceAmount'] = snapshot.regularAmount ?? null;
    patchPayload['playstationStoreDiscountPercent'] = snapshot.discountPercent ?? null;
    patchPayload['playstationStoreIsFree'] = snapshot.isFree ?? null;
    patchPayload['playstationStoreSaleEndsAt'] = snapshot.saleEndsAt ?? null;
    if (snapshot.imageUrl !== undefined) {
      patchPayload['playstationStoreImageUrl'] = snapshot.imageUrl;
    }
    // PS4/PS5 games used to be priced by psprices: drop its pin and lock now that the store has
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
      console.error('[playstation-store] wishlist_sale_notification_failed', {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function processQueuedPlayStationStorePriceRevalidation(
  pool: Pool,
  payload: PlayStationStorePriceRevalidationPayload,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<void> {
  const igdbGameId = normalizeGameId(payload.igdbGameId);
  const platformIgdbId = normalizePositiveInteger(payload.platformIgdbId);
  if (!igdbGameId || platformIgdbId === null) {
    throw new Error('Invalid PlayStation Store price revalidation payload.');
  }
  const platform = PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID.get(platformIgdbId);
  if (!platform) {
    throw new Error('Unsupported PlayStation Store platform for revalidation.');
  }

  const gamePayload = await readGamePayload(pool, igdbGameId, platformIgdbId);
  if (!gamePayload) {
    throw new Error('PlayStation Store revalidation game row not found.');
  }
  if (isManualPriceLock(gamePayload)) {
    return; // A manual price: nothing to refresh it from.
  }
  // The row as it is now decides, not what was captured when the job was queued: an admin may have
  // replaced or cleared the match since.
  const title = resolveLookupTitle(gamePayload) ?? normalizeNonEmptyString(payload.title);
  if (!title) {
    throw new Error('PlayStation Store revalidation missing title.');
  }
  const productId = resolvePinnedProductId(gamePayload);
  const locale = resolvePlayStationStoreLocale();
  const lookup = await lookupPlayStationStorePrice({
    title,
    platform,
    preferredProductId: productId,
    locale,
    fetchImpl: options.fetchImpl ?? fetch,
  });

  const isDiscoveryGame = isDiscoveryListType(gamePayload['listType']);
  const retryState = isDiscoveryGame
    ? nextProviderRetryState({
        current: maybeRearmProviderRetryState({
          // The same retry state and release year the refresh job was scheduled from.
          state: parseProviderRetryState(readRetryState(gamePayload)),
          nowMs: Date.now(),
          releaseYear: readReleaseYear(gamePayload),
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

  await persistPlayStationStoreSnapshot(pool, {
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
 * Payload fields that make a manually saved PlayStation Store price the cached snapshot, so the
 * route serves it rather than an older store lookup. Used by the admin match page.
 */
export function buildManualPlayStationStoreSnapshot(params: {
  platformIgdbId: number;
  productId: string | null;
  title: string | null;
  url: string | null;
  amount: number | null;
  currency: string | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  fetchedAt: string;
}): Record<string, unknown> {
  const locale = resolvePlayStationStoreLocale();
  return {
    playstationStoreFetchedAt: params.fetchedAt,
    playstationStoreSource: 'playstation_store',
    playstationStoreCountry: locale.country,
    playstationStoreLanguage: locale.language,
    playstationStorePlatform:
      PLAYSTATION_STORE_PLATFORM_BY_IGDB_ID.get(params.platformIgdbId) ?? null,
    playstationStoreProductId: params.productId,
    playstationStoreTitle: params.title,
    playstationStoreUrl: params.url,
    playstationStorePriceAmount: params.amount,
    playstationStorePriceCurrency: params.currency,
    playstationStoreRegularPriceAmount: params.regularAmount,
    playstationStoreDiscountPercent: params.discountPercent,
    playstationStoreIsFree: params.isFree,
    playstationStoreSaleEndsAt: null,
    playstationStoreMatchTitle: params.title,
    playstationStoreMatchScore: null,
    playstationStoreMatchConfidence: 'high',
  };
}

export const __playstationStorePriceTestables = {
  readSnapshotFromPayload,
  buildCacheKey,
  schedulePlayStationStorePriceRevalidation,
  isPricedGameForPlatform,
};
