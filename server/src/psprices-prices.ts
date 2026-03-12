import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, QueryResultRow } from 'pg';
import { incrementPspricesPriceMetric } from './cache-metrics.js';
import { config } from './config.js';
import { isDiscoveryListType } from './list-type.js';
import { maybeSendWishlistSaleNotification } from './price-sale-notifications.js';
import { isProviderMatchLocked } from './provider-match-lock.js';
import { resolvePreferredPsPricesUrl } from './psprices-url.js';

interface PsPricesRouteOptions {
  fetchImpl?: typeof fetch;
  nowProvider?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: PspricesPriceRevalidationPayload) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

interface GamePayloadRow extends QueryResultRow {
  payload: unknown;
}

type PsPricesRouteStatus = 'ok' | 'unsupported_platform' | 'unavailable';

interface PsPricesSnapshot {
  title: string | null;
  gameId?: string | null;
  amount: number | null;
  currency: string | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  url: string | null;
  metadataQualityScore?: number | null;
}

interface PsPricesMatchInfo {
  queryTitle: string;
  matchedTitle: string | null;
  score: number | null;
  confidence: 'high' | 'low' | 'none';
}

interface PsPricesCandidate extends PsPricesSnapshot {
  score: number;
}

type PsPricesSuffixClass =
  | 'base'
  | 'standard'
  | 'complete'
  | 'ultimate'
  | 'deluxe'
  | 'bundle'
  | 'expansion'
  | 'other';

interface RankedPsPricesCandidate {
  candidate: PsPricesSnapshot;
  score: number;
  coreScore: number;
  suffixClass: PsPricesSuffixClass;
  suffixRank: number;
  hasPlatformSuffix: boolean;
  hasContextPlatformSuffix: boolean;
}

type PlatformMarkerContext = 'playstation' | 'switch' | 'xbox' | null;

interface CachedPsPricesSnapshot {
  fetchedAt: string;
  snapshot: PsPricesSnapshot;
  match: PsPricesMatchInfo | null;
  candidates: PsPricesCandidate[];
}

interface PsPricesRouteResponse {
  status: PsPricesRouteStatus;
  igdbGameId: string;
  platformIgdbId: number;
  platform: string | null;
  region: string;
  show: string;
  cached: boolean;
  bestPrice: PsPricesSnapshot | null;
  match: PsPricesMatchInfo | null;
  candidates?: PsPricesCandidate[];
}

export interface PspricesPriceRevalidationPayload {
  cacheKey: string;
  igdbGameId: string;
  platformIgdbId: number;
  title?: string | null;
  psPricesUrl?: string | null;
}

const PSPRICES_PLATFORM_BY_IGDB_ID = new Map<number, string>([
  [48, 'PS4'],
  [167, 'PS5'],
  [130, 'Switch'],
  [508, 'Switch2']
]);
const PSPRICES_TITLE_MATCH_MIN_SCORE = 70;
const PSPRICES_TITLE_MATCH_MIN_GAP = 8;
const MAX_SEQUEL_NUMBER_TOKEN = 20;
const PSPRICES_SUFFIX_RANK_STRONG_CORE_THRESHOLD = PSPRICES_TITLE_MATCH_MIN_SCORE;
const DEFAULT_PSPRICES_PRICE_CACHE_FRESH_TTL_SECONDS = 86400;
const DEFAULT_PSPRICES_PRICE_CACHE_STALE_TTL_SECONDS = 86400 * 90;
const revalidationInFlightByKey = new Map<string, Promise<void>>();
const PSPRICES_REGION_CURRENCY_BY_CODE = new Map<string, string>([
  ['ch', 'CHF'],
  ['us', 'USD'],
  ['gb', 'GBP'],
  ['jp', 'JPY'],
  ['kr', 'KRW']
]);
const PSPRICES_SUFFIX_STANDARD_PATTERNS = [/\bstandard(?: edition)?\b/];
const PSPRICES_SUFFIX_COMPLETE_PATTERNS = [/\bcomplete(?: edition)?\b/];
const PSPRICES_SUFFIX_ULTIMATE_PATTERNS = [
  /\bultimate(?: edition)?\b/,
  /\bgold(?: edition)?\b/,
  /\bgoty\b/,
  /\bgame of the year(?: edition)?\b/,
  /\blegendary(?: edition)?\b/
];
const PSPRICES_SUFFIX_DELUXE_PATTERNS = [
  /\bdigital deluxe\b/,
  /\bsuper deluxe\b/,
  /\bdeluxe(?: edition)?\b/
];
const PSPRICES_SUFFIX_BUNDLE_PATTERNS = [/\bcollection\b/, /\bbundle\b/];
const PSPRICES_SUFFIX_EXPANSION_PATTERNS = [
  /\berweiterungspaket\b/,
  /\bexpansion(?: pack)?\b/,
  /\bdlc\b/,
  /\badd ?on\b/,
  /\baddon\b/,
  /\bupgrade\b/,
  /\bnext gen upgrade\b/,
  /\bps5 upgrade\b/,
  /\bseries x upgrade\b/,
  /\bseason pass\b/,
  /\bpass\b/,
  /\bstory pack\b/,
  /\bpack\b/,
  /\bepisode\b/,
  /\bchapter\b/
];
const PSPRICES_PLAYSTATION_SUFFIX_PATTERNS = [
  /\b(?:ps5|ps4|playstation 5|playstation 4)(?: edition)?$/g
];
const PSPRICES_SWITCH_SUFFIX_PATTERNS = [
  /\b(?:nintendo switch 2|switch 2|nintendo switch|switch)(?: edition)?$/g
];
const PSPRICES_XBOX_SUFFIX_PATTERNS = [
  /\b(?:xbox one|xbox series x s|xbox series x|xbox series s|xbox series|series x s|series x|series s|xbox)(?: edition)?$/g
];

export async function registerPsPricesRoute(
  app: FastifyInstance,
  pool: Pool,
  options: PsPricesRouteOptions = {}
): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, { global: false });
  }

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
    options.enableStaleWhileRevalidate ?? config.pspricesPriceCacheEnableStaleWhileRevalidate;
  const freshTtlSeconds = normalizeTtlSeconds(
    options.freshTtlSeconds,
    config.pspricesPriceCacheFreshTtlSeconds,
    DEFAULT_PSPRICES_PRICE_CACHE_FRESH_TTL_SECONDS
  );
  const staleTtlSeconds = Math.max(
    freshTtlSeconds,
    normalizeTtlSeconds(
      options.staleTtlSeconds,
      config.pspricesPriceCacheStaleTtlSeconds,
      DEFAULT_PSPRICES_PRICE_CACHE_STALE_TTL_SECONDS
    )
  );

  app.route({
    method: 'GET',
    url: '/v1/psprices/prices',
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    },
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const igdbGameId = normalizeGameId(query['igdbGameId']);
      const platformIgdbId = normalizePositiveInteger(query['platformIgdbId']);
      const titleOverride = normalizeNonEmptyString(query['title']);
      const hasTitleOverride = titleOverride !== null;
      const includeCandidates = normalizeBooleanQuery(query['includeCandidates']);

      if (!igdbGameId || platformIgdbId === null) {
        incrementPspricesPriceMetric('invalidRequests');
        reply.code(400).send({ error: 'igdbGameId and platformIgdbId are required.' });
        return;
      }

      const pspricesPlatform = PSPRICES_PLATFORM_BY_IGDB_ID.get(platformIgdbId) ?? null;
      if (pspricesPlatform === null) {
        const unsupportedPayload: PsPricesRouteResponse = {
          status: 'unsupported_platform',
          igdbGameId,
          platformIgdbId,
          platform: null,
          region: config.pspricesRegionPath,
          show: config.pspricesShow,
          cached: false,
          bestPrice: null,
          match: null,
          ...(includeCandidates ? { candidates: [] } : {})
        };
        reply.code(200).send(unsupportedPayload);
        return;
      }

      let payload: Record<string, unknown> | null = null;
      try {
        const row = await pool.query<GamePayloadRow>(
          'SELECT payload FROM games WHERE igdb_game_id = $1 AND platform_igdb_id = $2 LIMIT 1',
          [igdbGameId, platformIgdbId]
        );
        payload = normalizePayloadObject(row.rows[0]?.payload);
      } catch (error) {
        incrementPspricesPriceMetric('readErrors');
        request.log.warn({
          msg: 'psprices_read_failed',
          igdbGameId,
          platformIgdbId,
          platform: pspricesPlatform,
          error: error instanceof Error ? error.message : String(error)
        });
        reply.code(502).send({ error: 'Unable to read game pricing state.' });
        return;
      }

      if (!payload) {
        reply.code(404).send({ error: 'Game not found.' });
        return;
      }

      const persistedMatchQueryTitle = normalizeNonEmptyString(payload['psPricesMatchQueryTitle']);
      const title =
        titleOverride ?? persistedMatchQueryTitle ?? normalizeNonEmptyString(payload['title']);
      const preferredPsPricesUrl = hasTitleOverride ? null : resolvePreferredPsPricesUrl(payload);
      const psPricesMatchLocked = isProviderMatchLocked(payload, 'psPricesMatchLocked');
      if (!title) {
        const unavailablePayload: PsPricesRouteResponse = {
          status: 'unavailable',
          igdbGameId,
          platformIgdbId,
          platform: pspricesPlatform,
          region: config.pspricesRegionPath,
          show: config.pspricesShow,
          cached: false,
          bestPrice: null,
          match: null,
          ...(includeCandidates ? { candidates: [] } : {})
        };
        reply.code(200).send(unavailablePayload);
        return;
      }

      const cachedSnapshot = hasTitleOverride
        ? null
        : readPsPricesSnapshotFromPayload(
            payload,
            config.pspricesRegionPath,
            config.pspricesShow,
            pspricesPlatform
          );
      if (cachedSnapshot) {
        const ageSeconds = getAgeSeconds(cachedSnapshot.fetchedAt, nowProvider());

        if (ageSeconds <= freshTtlSeconds) {
          incrementPspricesPriceMetric('hits');
          reply.header('X-GameShelf-PSPrices-Cache', 'HIT_FRESH');
          const cachedStatus: PsPricesRouteStatus = isAvailableSnapshot(cachedSnapshot.snapshot)
            ? 'ok'
            : 'unavailable';
          const cachedPayload: PsPricesRouteResponse = {
            status: cachedStatus,
            igdbGameId,
            platformIgdbId,
            platform: pspricesPlatform,
            region: config.pspricesRegionPath,
            show: config.pspricesShow,
            cached: true,
            bestPrice: cachedSnapshot.snapshot,
            match: cachedSnapshot.match,
            ...(includeCandidates ? { candidates: cachedSnapshot.candidates } : {})
          };
          reply.code(200).send(cachedPayload);
          return;
        }

        if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds) {
          incrementPspricesPriceMetric('hits');
          incrementPspricesPriceMetric('staleServed');
          let scheduled = false;
          if (psPricesMatchLocked) {
            incrementPspricesPriceMetric('revalidateSkipped');
          } else {
            scheduled = schedulePspricesPriceRevalidation({
              cacheKey: buildPspricesPriceCacheKey({
                igdbGameId,
                platformIgdbId,
                regionPath: config.pspricesRegionPath,
                show: config.pspricesShow,
                platform: pspricesPlatform
              }),
              request,
              pool,
              payload,
              igdbGameId,
              platformIgdbId,
              title,
              preferredPsPricesUrl,
              fetchImpl,
              scheduleBackgroundRefresh,
              enqueueRevalidationJob: options.enqueueRevalidationJob
            });
          }

          reply.header('X-GameShelf-PSPrices-Cache', 'HIT_STALE');
          reply.header('X-GameShelf-PSPrices-Revalidate', scheduled ? 'scheduled' : 'skipped');

          const staleStatus: PsPricesRouteStatus = isAvailableSnapshot(cachedSnapshot.snapshot)
            ? 'ok'
            : 'unavailable';
          const stalePayload: PsPricesRouteResponse = {
            status: staleStatus,
            igdbGameId,
            platformIgdbId,
            platform: pspricesPlatform,
            region: config.pspricesRegionPath,
            show: config.pspricesShow,
            cached: true,
            bestPrice: cachedSnapshot.snapshot,
            match: cachedSnapshot.match,
            ...(includeCandidates ? { candidates: cachedSnapshot.candidates } : {})
          };
          reply.code(200).send(stalePayload);
          return;
        }
      }

      incrementPspricesPriceMetric('misses');
      try {
        const pspricesLookup = await fetchPsPricesSnapshot(fetchImpl, {
          title,
          platform: pspricesPlatform,
          regionPath: config.pspricesRegionPath,
          show: config.pspricesShow,
          preferredUrl: preferredPsPricesUrl
        });
        const pspricesSnapshot = pspricesLookup.snapshot;

        try {
          await persistPsPricesSnapshot(pool, {
            igdbGameId,
            platformIgdbId,
            payload,
            regionPath: config.pspricesRegionPath,
            show: config.pspricesShow,
            platform: pspricesPlatform,
            bestPrice: pspricesSnapshot,
            match: pspricesLookup.match,
            candidates: pspricesLookup.candidates,
            matchLocked: hasTitleOverride ? true : undefined
          });
          incrementPspricesPriceMetric('writes');
        } catch (error) {
          incrementPspricesPriceMetric('writeErrors');
          request.log.warn({
            msg: 'psprices_write_failed',
            igdbGameId,
            platformIgdbId,
            platform: pspricesPlatform,
            error: error instanceof Error ? error.message : String(error)
          });
        }

        const routeStatus: PsPricesRouteStatus = pspricesSnapshot ? 'ok' : 'unavailable';
        const responsePayload: PsPricesRouteResponse = {
          status: routeStatus,
          igdbGameId,
          platformIgdbId,
          platform: pspricesPlatform,
          region: config.pspricesRegionPath,
          show: config.pspricesShow,
          cached: false,
          bestPrice: pspricesSnapshot,
          match: pspricesLookup.match,
          ...(includeCandidates ? { candidates: pspricesLookup.candidates } : {})
        };
        reply.header('X-GameShelf-PSPrices-Cache', 'MISS');
        reply.code(200).send(responsePayload);
      } catch (error) {
        incrementPspricesPriceMetric('upstreamErrors');
        request.log.warn({
          msg: 'psprices_fetch_failed',
          igdbGameId,
          platformIgdbId,
          platform: pspricesPlatform,
          error: error instanceof Error ? error.message : String(error)
        });
        reply.code(502).send({ error: 'Unable to fetch PSPrices data.' });
      }
    }
  });
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
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(',', '.');
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBooleanQuery(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

function buildPspricesPriceCacheKey(params: {
  igdbGameId: string;
  platformIgdbId: number;
  regionPath: string;
  show: string;
  platform: string;
}): string {
  return [
    params.igdbGameId,
    String(params.platformIgdbId),
    params.regionPath.toLowerCase(),
    params.show.toLowerCase(),
    params.platform.toLowerCase()
  ].join(':');
}

function readPsPricesSnapshotFromPayload(
  payload: Record<string, unknown>,
  regionPath: string,
  show: string,
  platform: string
): CachedPsPricesSnapshot | null {
  const fetchedAt = normalizeNonEmptyString(payload['psPricesFetchedAt']);
  const cachedRegion = normalizeNonEmptyString(payload['psPricesRegionPath']);
  const cachedShow = normalizeNonEmptyString(payload['psPricesShow']);
  const cachedPlatform = normalizeNonEmptyString(payload['psPricesPlatform']);

  if (
    !fetchedAt ||
    cachedRegion !== regionPath ||
    cachedShow !== show ||
    cachedPlatform !== platform
  ) {
    return null;
  }

  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return null;
  }

  const matchQueryTitle = normalizeNonEmptyString(payload['psPricesMatchQueryTitle']);
  const matchTitle = normalizeNonEmptyString(payload['psPricesMatchTitle']);
  const matchScore = normalizeNumberOrNull(payload['psPricesMatchScore']);
  const matchConfidenceRaw = normalizeNonEmptyString(payload['psPricesMatchConfidence']);
  const matchConfidence =
    matchConfidenceRaw === 'high' || matchConfidenceRaw === 'low' || matchConfidenceRaw === 'none'
      ? matchConfidenceRaw
      : null;
  const candidatesRaw = Array.isArray(payload['psPricesCandidates'])
    ? (payload['psPricesCandidates'] as unknown[])
    : [];
  const candidates = candidatesRaw
    .map((entry) => normalizePsPricesCachedCandidate(entry, regionPath))
    .filter((entry): entry is PsPricesCandidate => entry !== null)
    .slice(0, 30);
  const fallbackCurrency = inferCurrencyFromRegionPath(regionPath);

  return {
    fetchedAt,
    snapshot: {
      title: normalizeNonEmptyString(payload['psPricesTitle']),
      amount: normalizeNumberOrNull(payload['psPricesPriceAmount']),
      currency: normalizeNonEmptyString(payload['psPricesPriceCurrency']) ?? fallbackCurrency,
      regularAmount: normalizeNumberOrNull(payload['psPricesRegularPriceAmount']),
      discountPercent: normalizeNumberOrNull(payload['psPricesDiscountPercent']),
      isFree: normalizeBooleanOrNull(payload['psPricesIsFree']),
      url: normalizeNonEmptyString(payload['psPricesUrl'])
    },
    match:
      matchQueryTitle && matchConfidence
        ? {
            queryTitle: matchQueryTitle,
            matchedTitle: matchTitle,
            score: matchScore,
            confidence: matchConfidence
          }
        : null,
    candidates
  };
}

function isAvailableSnapshot(snapshot: PsPricesSnapshot): boolean {
  return snapshot.amount !== null || snapshot.isFree === true;
}

function schedulePspricesPriceRevalidation(params: {
  cacheKey: string;
  request: FastifyRequest;
  pool: Pool;
  payload: Record<string, unknown>;
  igdbGameId: string;
  platformIgdbId: number;
  title: string;
  preferredPsPricesUrl: string | null;
  fetchImpl: typeof fetch;
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: PspricesPriceRevalidationPayload) => void;
}): boolean {
  const revalidationPayload: PspricesPriceRevalidationPayload = {
    cacheKey: params.cacheKey,
    igdbGameId: params.igdbGameId,
    platformIgdbId: params.platformIgdbId,
    title: params.title,
    psPricesUrl: params.preferredPsPricesUrl
  };

  if (params.enqueueRevalidationJob) {
    incrementPspricesPriceMetric('revalidateScheduled');
    params.enqueueRevalidationJob(revalidationPayload);
    return true;
  }

  if (revalidationInFlightByKey.has(params.cacheKey)) {
    incrementPspricesPriceMetric('revalidateSkipped');
    return false;
  }

  incrementPspricesPriceMetric('revalidateScheduled');

  let resolveDone: (() => void) | null = null;
  const inFlight = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  revalidationInFlightByKey.set(params.cacheKey, inFlight);

  params.scheduleBackgroundRefresh(async () => {
    try {
      const pspricesPlatform = PSPRICES_PLATFORM_BY_IGDB_ID.get(params.platformIgdbId) ?? null;
      if (!pspricesPlatform) {
        throw new Error('Unsupported PSPrices platform for revalidation.');
      }

      const pspricesLookup = await fetchPsPricesSnapshot(params.fetchImpl, {
        title: params.title,
        platform: pspricesPlatform,
        regionPath: config.pspricesRegionPath,
        show: config.pspricesShow,
        preferredUrl: params.preferredPsPricesUrl
      });

      await persistPsPricesSnapshot(params.pool, {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        payload: params.payload,
        regionPath: config.pspricesRegionPath,
        show: config.pspricesShow,
        platform: pspricesPlatform,
        bestPrice: pspricesLookup.snapshot,
        match: pspricesLookup.match,
        candidates: pspricesLookup.candidates
      });
      incrementPspricesPriceMetric('writes');
      incrementPspricesPriceMetric('revalidateSucceeded');
    } catch (error) {
      incrementPspricesPriceMetric('revalidateFailed');
      params.request.log.warn({
        msg: 'psprices_revalidate_failed',
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      revalidationInFlightByKey.delete(params.cacheKey);
      resolveDone?.();
    }
  });

  return true;
}

async function fetchPsPricesSnapshot(
  fetchImpl: typeof fetch,
  params: {
    title: string;
    platform: string;
    regionPath: string;
    show: string;
    preferredUrl?: string | null;
  }
): Promise<{
  snapshot: PsPricesSnapshot | null;
  match: PsPricesMatchInfo;
  candidates: PsPricesCandidate[];
}> {
  const endpoint = new URL('/v1/psprices/search', config.pspricesScraperBaseUrl);
  endpoint.searchParams.set('q', params.title);
  endpoint.searchParams.set('platform', params.platform);
  endpoint.searchParams.set('region', params.regionPath);
  endpoint.searchParams.set('show', params.show);
  endpoint.searchParams.set('includeCandidates', '1');

  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (config.pspricesScraperToken.length > 0) {
    headers['Authorization'] = `Bearer ${config.pspricesScraperToken}`;
  }

  const response = await fetchWithTimeout(fetchImpl, endpoint.toString(), headers, 15_000);
  if (!response.ok) {
    throw new Error(`PSPrices request failed with status ${String(response.status)}`);
  }

  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      snapshot: null,
      match: {
        queryTitle: params.title,
        matchedTitle: null,
        score: null,
        confidence: 'none'
      },
      candidates: []
    };
  }

  const payloadRecord = payload as Record<string, unknown>;
  const fallbackCurrency = inferCurrencyFromRegionPath(params.regionPath);
  const candidatesRaw: unknown[] = Array.isArray(payloadRecord['candidates'])
    ? (payloadRecord['candidates'] as unknown[])
    : [];
  const itemRaw = payloadRecord['item'];
  const fallbackItem =
    itemRaw && typeof itemRaw === 'object' && !Array.isArray(itemRaw) ? [itemRaw] : [];
  const candidates = [...candidatesRaw, ...fallbackItem]
    .map((entry) => normalizePsPricesCandidate(entry, fallbackCurrency))
    .filter((entry): entry is PsPricesSnapshot => entry !== null);
  const dedupedCandidates = dedupePsPricesCandidates(candidates);

  if (dedupedCandidates.length === 0) {
    return {
      snapshot: null,
      match: {
        queryTitle: params.title,
        matchedTitle: null,
        score: null,
        confidence: 'none'
      },
      candidates: []
    };
  }

  const platformContext = derivePlatformMarkerContext(params.platform);
  const expectedCore = buildCoreTitleForScoring(params.title, platformContext).coreTitle;
  const ranked = dedupedCandidates
    .map((candidate) => {
      const titleValue = candidate.title ?? '';
      const candidateCore = buildCoreTitleForScoring(titleValue, platformContext);
      const coreScore = scorePsPricesCoreTitleMatch(expectedCore, candidateCore.coreTitle);
      const suffixClass = classifyPsPricesSuffixClass(candidateCore.suffixInspectionTitle);
      const score = round2(
        applyPsPricesSuffixShaping({
          coreScore,
          suffixClass,
          strongCoreThreshold: PSPRICES_SUFFIX_RANK_STRONG_CORE_THRESHOLD
        })
      );
      return {
        candidate,
        score,
        coreScore,
        suffixClass,
        suffixRank: resolvePsPricesSuffixRank(suffixClass),
        hasPlatformSuffix: candidateCore.hasPlatformSuffix,
        hasContextPlatformSuffix: candidateCore.hasContextPlatformSuffix
      } satisfies RankedPsPricesCandidate;
    })
    .sort((left, right) => compareRankedPsPricesCandidates(left, right));
  const preferredUrl = normalizeNonEmptyString(params.preferredUrl);
  const preferredMatch =
    preferredUrl === null
      ? null
      : (ranked.find((entry) => normalizeNonEmptyString(entry.candidate.url) === preferredUrl) ??
        null);

  if (preferredMatch) {
    return {
      snapshot: preferredMatch.candidate,
      match: {
        queryTitle: params.title,
        matchedTitle: preferredMatch.candidate.title,
        score: round2(preferredMatch.score),
        confidence: 'high'
      },
      candidates: ranked.slice(0, 30).map((entry) => ({
        ...entry.candidate,
        score: round2(entry.score)
      }))
    };
  }
  const best = ranked[0];
  const second = ranked[1];

  const hasHighConfidenceMatch =
    best.coreScore >= PSPRICES_TITLE_MATCH_MIN_SCORE &&
    (ranked.length === 1 ||
      best.coreScore - second.coreScore >= PSPRICES_TITLE_MATCH_MIN_GAP ||
      isResolvedStrongCoreSuffixTie(best, second) ||
      isResolvedDuplicateTie(best, second));

  return {
    snapshot: hasHighConfidenceMatch ? best.candidate : null,
    match: {
      queryTitle: params.title,
      matchedTitle: best.candidate.title,
      score: round2(best.score),
      confidence: hasHighConfidenceMatch ? 'high' : 'low'
    },
    candidates: ranked.slice(0, 30).map((entry) => ({
      ...entry.candidate,
      score: round2(entry.score)
    }))
  };
}

function dedupePsPricesCandidates(candidates: PsPricesSnapshot[]): PsPricesSnapshot[] {
  const byKey = new Map<string, PsPricesSnapshot>();
  for (const candidate of candidates) {
    const key = `${candidate.title ?? ''}::${candidate.url ?? ''}::${String(candidate.amount ?? '')}`;
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function normalizePsPricesCandidate(
  item: unknown,
  fallbackCurrency?: string | null
): PsPricesSnapshot | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }
  const candidate = item as Record<string, unknown>;
  const title = normalizeNonEmptyString(candidate['title']);
  if (!title) {
    return null;
  }

  const amount = normalizeNumberOrNull(candidate['priceAmount'] ?? candidate['amount']);
  const currency = normalizeNonEmptyString(candidate['currency']) ?? fallbackCurrency ?? null;
  const regularAmount = normalizeNumberOrNull(
    candidate['regularPriceAmount'] ?? candidate['regularAmount']
  );
  const discountPercent = normalizeNumberOrNull(candidate['discountPercent']);
  const gameId = normalizeNonEmptyString(candidate['gameId']);
  const isFreeRaw = candidate['isFree'];
  const isFree =
    typeof isFreeRaw === 'boolean'
      ? isFreeRaw
      : normalizeNonEmptyString(candidate['priceText'])?.toLowerCase() === 'free';
  const url = normalizeNonEmptyString(candidate['url'] ?? candidate['pspricesUrl']);

  if (amount === null && !isFree) {
    return null;
  }

  return {
    title,
    gameId,
    amount: amount === null && isFree ? 0 : amount !== null ? round2(amount) : null,
    currency,
    regularAmount: regularAmount !== null ? round2(regularAmount) : null,
    discountPercent: discountPercent !== null ? round2(discountPercent) : null,
    isFree,
    url,
    metadataQualityScore: resolveRawCandidateQualityScore(candidate)
  };
}

function resolveRawCandidateQualityScore(candidate: Record<string, unknown>): number {
  let score = 0;

  const metacriticScore = normalizeNumberOrNull(candidate['metacriticScore']);
  if (metacriticScore !== null && metacriticScore >= 0 && metacriticScore <= 100) {
    score += 6;
  }

  const openCriticScore = normalizeNumberOrNull(candidate['openCriticScore']);
  if (openCriticScore !== null && openCriticScore >= 0 && openCriticScore <= 100) {
    score += 2;
  }

  const collectionTagCount = normalizeNumberOrNull(candidate['collectionTagCount']);
  if (collectionTagCount !== null && collectionTagCount > 0) {
    score += Math.min(3, Math.round(collectionTagCount));
  }

  if (candidate['hasMostEngagingTag'] === true || candidate['hasMostEngagingTag'] === 'true') {
    score += 2;
  }

  return score;
}

function resolveCandidateQualityScore(candidate: PsPricesSnapshot): number {
  return typeof candidate.metadataQualityScore === 'number' &&
    Number.isFinite(candidate.metadataQualityScore)
    ? candidate.metadataQualityScore
    : 0;
}

function parseCandidateGameId(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isResolvedStrongCoreSuffixTie(
  best: RankedPsPricesCandidate,
  second: RankedPsPricesCandidate | undefined
): boolean {
  if (!second) {
    return false;
  }
  if (
    best.coreScore < PSPRICES_SUFFIX_RANK_STRONG_CORE_THRESHOLD ||
    second.coreScore < PSPRICES_SUFFIX_RANK_STRONG_CORE_THRESHOLD
  ) {
    return false;
  }
  if (Math.abs(best.coreScore - second.coreScore) > PSPRICES_TITLE_MATCH_MIN_GAP) {
    return false;
  }
  return best.suffixRank < second.suffixRank;
}

function isResolvedDuplicateTie(
  best: RankedPsPricesCandidate,
  second: RankedPsPricesCandidate | undefined
): boolean {
  if (!second || best.coreScore !== second.coreScore || best.suffixRank !== second.suffixRank) {
    return false;
  }

  const bestTitle = normalizeTitleForMatch(best.candidate.title ?? '');
  const secondTitle = normalizeTitleForMatch(second.candidate.title ?? '');
  if (!bestTitle || bestTitle !== secondTitle) {
    return false;
  }

  const bestQuality = resolveCandidateQualityScore(best.candidate);
  const secondQuality = resolveCandidateQualityScore(second.candidate);
  return bestQuality > secondQuality;
}

function normalizePsPricesCachedCandidate(
  item: unknown,
  regionPath: string
): PsPricesCandidate | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const record = item as Record<string, unknown>;
  const normalized = normalizePsPricesCandidate(record, inferCurrencyFromRegionPath(regionPath));
  if (!normalized) {
    return null;
  }

  const scoreRaw = normalizeNumberOrNull(record['score']);
  const score = scoreRaw !== null ? round2(scoreRaw) : 0;

  return {
    ...normalized,
    score
  };
}

function inferCurrencyFromRegionPath(regionPath: string): string | null {
  const normalized = regionPath.trim().toLowerCase();
  const match = normalized.match(/^region-([a-z]{2})(?:$|[^a-z])/);
  if (!match) {
    return null;
  }

  const regionCode = match[1];
  return PSPRICES_REGION_CURRENCY_BY_CODE.get(regionCode) ?? null;
}

function normalizeTitleForMatch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scorePsPricesCoreTitleMatch(expectedTitle: string, candidateTitle: string): number {
  const expected = expectedTitle;
  const candidate = candidateTitle;
  if (!expected || !candidate) {
    return 0;
  }
  if (expected === candidate) {
    return 100;
  }

  let score = 0;
  if (expected.includes(candidate) || candidate.includes(expected)) {
    score += 20;
  }

  const expectedTokens = new Set(expected.split(' ').filter(Boolean));
  const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
  const overlap = [...expectedTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...expectedTokens, ...candidateTokens]).size;
  if (union > 0) {
    score += (overlap / union) * 80;
  }
  return score;
}

function compareRankedPsPricesCandidates(
  left: RankedPsPricesCandidate,
  right: RankedPsPricesCandidate
): number {
  if (
    left.coreScore >= PSPRICES_SUFFIX_RANK_STRONG_CORE_THRESHOLD &&
    right.coreScore >= PSPRICES_SUFFIX_RANK_STRONG_CORE_THRESHOLD
  ) {
    const coreGap = Math.abs(left.coreScore - right.coreScore);
    if (coreGap > PSPRICES_TITLE_MATCH_MIN_GAP) {
      return right.coreScore - left.coreScore;
    }
    if (left.suffixRank !== right.suffixRank) {
      return left.suffixRank - right.suffixRank;
    }
    const baseStandardOrder = compareEquivalentSuffixClass(left.suffixClass, right.suffixClass);
    if (baseStandardOrder !== 0) {
      return baseStandardOrder;
    }
    if (left.hasPlatformSuffix !== right.hasPlatformSuffix) {
      return left.hasPlatformSuffix ? 1 : -1;
    }
    if (left.hasContextPlatformSuffix !== right.hasContextPlatformSuffix) {
      return left.hasContextPlatformSuffix ? -1 : 1;
    }
  } else if (right.coreScore !== left.coreScore) {
    return right.coreScore - left.coreScore;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const rightQuality = resolveCandidateQualityScore(right.candidate);
  const leftQuality = resolveCandidateQualityScore(left.candidate);
  if (rightQuality !== leftQuality) {
    return rightQuality - leftQuality;
  }
  const rightHasPrice = right.candidate.amount !== null ? 1 : 0;
  const leftHasPrice = left.candidate.amount !== null ? 1 : 0;
  if (rightHasPrice !== leftHasPrice) {
    return rightHasPrice - leftHasPrice;
  }
  const rightId = parseCandidateGameId(right.candidate.gameId);
  const leftId = parseCandidateGameId(left.candidate.gameId);
  if (rightId !== null && leftId !== null && rightId !== leftId) {
    return leftId - rightId;
  }
  return 0;
}

function compareEquivalentSuffixClass(
  left: PsPricesSuffixClass,
  right: PsPricesSuffixClass
): number {
  if (left === right) {
    return 0;
  }
  if (left === 'base' && right === 'standard') {
    return -1;
  }
  if (left === 'standard' && right === 'base') {
    return 1;
  }
  return 0;
}

function applyPsPricesSuffixShaping(args: {
  coreScore: number;
  suffixClass: PsPricesSuffixClass;
  strongCoreThreshold: number;
}): number {
  if (args.coreScore < args.strongCoreThreshold) {
    return args.coreScore;
  }

  const penaltyByClass: Record<PsPricesSuffixClass, number> = {
    base: 0,
    standard: 0,
    complete: 2,
    ultimate: 4,
    deluxe: 7,
    bundle: 10,
    expansion: 18,
    other: 12
  };
  return Math.max(0, args.coreScore - penaltyByClass[args.suffixClass]);
}

function resolvePsPricesSuffixRank(suffixClass: PsPricesSuffixClass): number {
  const rankByClass: Record<PsPricesSuffixClass, number> = {
    base: 0,
    standard: 0,
    complete: 1,
    ultimate: 2,
    deluxe: 3,
    bundle: 4,
    expansion: 5,
    other: 6
  };
  return rankByClass[suffixClass];
}

function classifyPsPricesSuffixClass(value: string): PsPricesSuffixClass {
  const normalized = value.trim();
  if (!normalized) {
    return 'base';
  }

  const suffixInput = normalizeSuffixInspectionInput(normalized);
  const suffixSegment = suffixInput[suffixInput.length - 1] ?? normalized;
  const tail = normalized.split(' ').slice(-8).join(' ');
  const classifierInput = `${suffixSegment} ${tail}`.trim();

  if (hasPsPricesSuffixPattern(classifierInput, PSPRICES_SUFFIX_EXPANSION_PATTERNS)) {
    return 'expansion';
  }
  if (hasPsPricesSuffixPattern(classifierInput, PSPRICES_SUFFIX_BUNDLE_PATTERNS)) {
    return 'bundle';
  }
  if (hasPsPricesSuffixPattern(classifierInput, PSPRICES_SUFFIX_DELUXE_PATTERNS)) {
    return 'deluxe';
  }
  if (hasPsPricesSuffixPattern(classifierInput, PSPRICES_SUFFIX_ULTIMATE_PATTERNS)) {
    return 'ultimate';
  }
  if (hasPsPricesSuffixPattern(classifierInput, PSPRICES_SUFFIX_COMPLETE_PATTERNS)) {
    return 'complete';
  }
  if (hasPsPricesSuffixPattern(classifierInput, PSPRICES_SUFFIX_STANDARD_PATTERNS)) {
    return 'standard';
  }

  if (suffixInput.length <= 1) {
    return 'base';
  }

  return 'other';
}

function normalizeSuffixInspectionInput(value: string): string[] {
  const normalized = value.replace(/[—–]/g, '-').replace(/[:()]/g, '-').replace(/\s+/g, ' ').trim();

  const segments = normalized
    .split(/\s*-\s*/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return [value];
  }
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function hasPsPricesSuffixPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeSequelNumberToken(token: string): string {
  const arabic = parseArabicSequelNumberToken(token);
  if (arabic !== null) {
    return `seq_${String(arabic)}`;
  }

  const roman = parseRomanSequelNumberToken(token);
  if (roman !== null) {
    return `seq_${String(roman)}`;
  }

  return token;
}

function parseArabicSequelNumberToken(token: string): number | null {
  if (!/^\d+$/.test(token)) {
    return null;
  }

  const parsed = Number.parseInt(token, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_SEQUEL_NUMBER_TOKEN) {
    return null;
  }

  return parsed;
}

function parseRomanSequelNumberToken(token: string): number | null {
  const roman = token.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(roman)) {
    return null;
  }

  const values = new Map<string, number>([
    ['I', 1],
    ['V', 5],
    ['X', 10],
    ['L', 50],
    ['C', 100],
    ['D', 500],
    ['M', 1000]
  ]);

  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = values.get(roman[index]) ?? 0;
    const next = values.get(roman[index + 1] ?? '') ?? 0;
    total += current < next ? -current : current;
  }

  if (total < 1 || total > MAX_SEQUEL_NUMBER_TOKEN) {
    return null;
  }

  const canonical = toRoman(total);
  return canonical === roman ? total : null;
}

function toRoman(value: number): string {
  const symbols: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I']
  ];

  let remaining = value;
  let result = '';
  for (const [numeric, symbol] of symbols) {
    while (remaining >= numeric) {
      result += symbol;
      remaining -= numeric;
    }
  }
  return result;
}

function isLowSignalTitleToken(token: string): boolean {
  return token === 'the' || token === 'a' || token === 'an' || token === 'and' || token === 'of';
}

function isEditionClassifierToken(token: string): boolean {
  return (
    token === 'standard' ||
    token === 'edition' ||
    token === 'complete' ||
    token === 'ultimate' ||
    token === 'gold' ||
    token === 'goty' ||
    token === 'legendary' ||
    token === 'deluxe' ||
    token === 'digital' ||
    token === 'super' ||
    token === 'collection' ||
    token === 'bundle' ||
    token === 'expansion' ||
    token === 'dlc' ||
    token === 'add' ||
    token === 'on' ||
    token === 'addon' ||
    token === 'season' ||
    token === 'pass' ||
    token === 'story' ||
    token === 'pack' ||
    token === 'episode' ||
    token === 'chapter' ||
    token === 'erweiterungspaket' ||
    token === 'remastered' ||
    token === 'remake'
  );
}

function derivePlatformMarkerContext(platform: string | null | undefined): PlatformMarkerContext {
  const normalized = normalizeTitleForMatch(platform ?? '');
  if (normalized === 'ps4' || normalized === 'ps5' || normalized.includes('playstation')) {
    return 'playstation';
  }
  if (normalized === 'switch' || normalized === 'switch2' || normalized.includes('switch')) {
    return 'switch';
  }
  if (normalized.includes('xbox')) {
    return 'xbox';
  }
  return null;
}

function buildCoreTitleForScoring(
  value: string,
  platformContext: PlatformMarkerContext
): {
  coreTitle: string;
  suffixInspectionTitle: string;
  hasPlatformSuffix: boolean;
  hasContextPlatformSuffix: boolean;
} {
  const normalized = normalizeTitleForMatch(value);
  const platformStripped = stripPlatformSuffixFromNormalizedTitle(normalized, platformContext);
  const filteredTokens = platformStripped.coreTitle
    .split(' ')
    .filter((token) => token.length > 0)
    .map((token) => normalizeSequelNumberToken(token))
    .filter((token) => !isEditionClassifierToken(token))
    .filter((token) => !isLowSignalTitleToken(token));

  if (filteredTokens.length === 0) {
    return {
      coreTitle: platformStripped.coreTitle,
      suffixInspectionTitle: platformStripped.coreTitle,
      hasPlatformSuffix: platformStripped.hasPlatformSuffix,
      hasContextPlatformSuffix: platformStripped.hasContextPlatformSuffix
    };
  }

  return {
    coreTitle: filteredTokens.join(' '),
    suffixInspectionTitle: platformStripped.coreTitle,
    hasPlatformSuffix: platformStripped.hasPlatformSuffix,
    hasContextPlatformSuffix: platformStripped.hasContextPlatformSuffix
  };
}

function stripPlatformSuffixFromNormalizedTitle(
  normalizedTitle: string,
  platformContext: PlatformMarkerContext
): { coreTitle: string; hasPlatformSuffix: boolean; hasContextPlatformSuffix: boolean } {
  if (!normalizedTitle || platformContext === null) {
    return {
      coreTitle: normalizedTitle,
      hasPlatformSuffix: false,
      hasContextPlatformSuffix: false
    };
  }

  const contextPatterns = resolveContextPlatformSuffixPatterns(platformContext);
  const patterns = resolvePlatformSuffixPatterns(platformContext);
  let candidate = normalizedTitle;
  let removedAny = false;
  let removedContext = false;
  for (let i = 0; i < 2; i += 1) {
    const before = candidate;
    for (const pattern of patterns) {
      const updated = candidate.replace(pattern, '').replace(/\s+/g, ' ').trim();
      if (updated !== candidate && contextPatterns.includes(pattern)) {
        removedContext = true;
      }
      candidate = updated;
    }
    if (candidate === before) {
      break;
    }
    removedAny = true;
  }
  return {
    coreTitle: candidate,
    hasPlatformSuffix: removedAny,
    hasContextPlatformSuffix: removedContext
  };
}

function resolvePlatformSuffixPatterns(platformContext: PlatformMarkerContext): RegExp[] {
  const allPatterns = [
    ...PSPRICES_PLAYSTATION_SUFFIX_PATTERNS,
    ...PSPRICES_SWITCH_SUFFIX_PATTERNS,
    ...PSPRICES_XBOX_SUFFIX_PATTERNS
  ];

  if (platformContext === 'playstation') {
    return [
      ...PSPRICES_PLAYSTATION_SUFFIX_PATTERNS,
      ...PSPRICES_SWITCH_SUFFIX_PATTERNS,
      ...PSPRICES_XBOX_SUFFIX_PATTERNS
    ];
  }
  if (platformContext === 'switch') {
    return [
      ...PSPRICES_SWITCH_SUFFIX_PATTERNS,
      ...PSPRICES_PLAYSTATION_SUFFIX_PATTERNS,
      ...PSPRICES_XBOX_SUFFIX_PATTERNS
    ];
  }
  if (platformContext === 'xbox') {
    return [
      ...PSPRICES_XBOX_SUFFIX_PATTERNS,
      ...PSPRICES_PLAYSTATION_SUFFIX_PATTERNS,
      ...PSPRICES_SWITCH_SUFFIX_PATTERNS
    ];
  }
  return allPatterns;
}

function resolveContextPlatformSuffixPatterns(platformContext: PlatformMarkerContext): RegExp[] {
  if (platformContext === 'playstation') {
    return PSPRICES_PLAYSTATION_SUFFIX_PATTERNS;
  }
  if (platformContext === 'switch') {
    return PSPRICES_SWITCH_SUFFIX_PATTERNS;
  }
  if (platformContext === 'xbox') {
    return PSPRICES_XBOX_SUFFIX_PATTERNS;
  }
  return [];
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function persistPsPricesSnapshot(
  pool: Pool,
  params: {
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
    regionPath: string;
    show: string;
    platform: string;
    bestPrice: PsPricesSnapshot | null;
    match: PsPricesMatchInfo;
    candidates: PsPricesCandidate[];
    matchLocked?: boolean;
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const preserveExisting = params.bestPrice === null;
  const patchPayload: Record<string, unknown> = {
    psPricesFetchedAt: fetchedAt,
    psPricesSource: 'psprices',
    psPricesRegionPath: params.regionPath,
    psPricesShow: params.show,
    psPricesPlatform: params.platform,
    psPricesMatchQueryTitle: params.match.queryTitle,
    psPricesMatchTitle: params.match.matchedTitle,
    psPricesMatchScore: params.match.score,
    psPricesMatchConfidence: params.match.confidence,
    psPricesCandidates: params.candidates.slice(0, 30).map((candidate) => ({
      title: candidate.title,
      gameId: candidate.gameId ?? null,
      amount: candidate.amount,
      currency: candidate.currency,
      regularAmount: candidate.regularAmount,
      discountPercent: candidate.discountPercent,
      isFree: candidate.isFree,
      url: candidate.url,
      metadataQualityScore: candidate.metadataQualityScore ?? 0,
      score: candidate.score
    }))
  };
  if (typeof params.matchLocked === 'boolean') {
    patchPayload['psPricesMatchLocked'] = params.matchLocked;
  }
  if (!preserveExisting) {
    patchPayload['priceSource'] = 'psprices';
    patchPayload['priceFetchedAt'] = fetchedAt;
    patchPayload['priceAmount'] = params.bestPrice.amount;
    patchPayload['priceCurrency'] = params.bestPrice.currency ?? null;
    patchPayload['priceRegularAmount'] = params.bestPrice.regularAmount ?? null;
    patchPayload['priceDiscountPercent'] = params.bestPrice.discountPercent ?? null;
    patchPayload['priceIsFree'] = params.bestPrice.isFree ?? null;
    patchPayload['priceUrl'] = params.bestPrice.url ?? null;
    patchPayload['psPricesTitle'] = params.bestPrice.title ?? null;
    patchPayload['psPricesPriceAmount'] = params.bestPrice.amount;
    patchPayload['psPricesPriceCurrency'] = params.bestPrice.currency ?? null;
    patchPayload['psPricesRegularPriceAmount'] = params.bestPrice.regularAmount ?? null;
    patchPayload['psPricesDiscountPercent'] = params.bestPrice.discountPercent ?? null;
    patchPayload['psPricesIsFree'] = params.bestPrice.isFree ?? null;
    patchPayload['psPricesUrl'] = params.bestPrice.url ?? null;
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

  const previousPayloadCandidate = normalizePayloadObject(updateResult.rows[0]?.previous_payload);
  const updatedPayloadCandidate = normalizePayloadObject(updateResult.rows[0]?.next_payload);
  const previousPayload = previousPayloadCandidate ?? params.payload;
  const updatedPayload = updatedPayloadCandidate ?? params.payload;
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
        nextPayload: updatedPayload
      });
    } catch (error) {
      console.error('[psprices] wishlist_sale_notification_failed', {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export async function processQueuedPspricesPriceRevalidation(
  pool: Pool,
  payload: PspricesPriceRevalidationPayload
): Promise<void> {
  const igdbGameId = normalizeGameId(payload.igdbGameId);
  const platformIgdbId = normalizePositiveInteger(payload.platformIgdbId);
  if (!igdbGameId || platformIgdbId === null) {
    throw new Error('Invalid psprices price revalidation payload.');
  }

  const row = await pool.query<GamePayloadRow>(
    'SELECT payload FROM games WHERE igdb_game_id = $1 AND platform_igdb_id = $2 LIMIT 1',
    [igdbGameId, platformIgdbId]
  );
  const gamePayload = normalizePayloadObject(row.rows[0]?.payload);
  if (!gamePayload) {
    throw new Error('PSPrices revalidation game row not found.');
  }
  if (isProviderMatchLocked(gamePayload, 'psPricesMatchLocked')) {
    return;
  }

  const pspricesPlatform = PSPRICES_PLATFORM_BY_IGDB_ID.get(platformIgdbId) ?? null;
  if (!pspricesPlatform) {
    throw new Error('Unsupported PSPrices platform for revalidation.');
  }

  const title =
    normalizeNonEmptyString(payload.title) ??
    normalizeNonEmptyString(gamePayload['psPricesMatchQueryTitle']) ??
    normalizeNonEmptyString(gamePayload['title']);
  const preferredPsPricesUrl =
    normalizeNonEmptyString(payload.psPricesUrl) ?? resolvePreferredPsPricesUrl(gamePayload);
  if (!title) {
    throw new Error('PSPrices revalidation missing title.');
  }

  const pspricesLookup = await fetchPsPricesSnapshot(fetch, {
    title,
    platform: pspricesPlatform,
    regionPath: config.pspricesRegionPath,
    show: config.pspricesShow,
    preferredUrl: preferredPsPricesUrl
  });

  await persistPsPricesSnapshot(pool, {
    igdbGameId,
    platformIgdbId,
    payload: gamePayload,
    regionPath: config.pspricesRegionPath,
    show: config.pspricesShow,
    platform: pspricesPlatform,
    bestPrice: pspricesLookup.snapshot,
    match: pspricesLookup.match,
    candidates: pspricesLookup.candidates
  });
}

export const __pspricesTestables = {
  readPsPricesSnapshotFromPayload,
  buildPspricesPriceCacheKey,
  schedulePspricesPriceRevalidation
};
