import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool, QueryResultRow } from 'pg';
import { incrementPspricesPriceMetric } from './cache-metrics.js';
import { config } from './config.js';
import { isDiscoveryListType } from './list-type.js';
import { maybeSendWishlistSaleNotification } from './price-sale-notifications.js';
import { matchCandidatesByTitle, type TitleMatchInfo } from './price-title-matching.js';
import { round2 } from './utils/round.js';
import { normalizePreferredPsPricesUrl, resolvePreferredPsPricesUrl } from './psprices-url.js';
import { applyRouteRateLimit, ensureRateLimitRegistered } from './rate-limit.js';
import {
  hasMeaningfulRetryState,
  maybeRearmProviderRetryState,
  nextProviderRetryState,
  parseProviderRetryState,
} from './recommendations/provider-retry-state.js';

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
  imageUrl?: string | null;
  metadataQualityScore?: number | null;
}

interface PsPricesCandidate extends PsPricesSnapshot {
  score: number;
}

interface CachedPsPricesSnapshot {
  fetchedAt: string;
  snapshot: PsPricesSnapshot;
  match: TitleMatchInfo | null;
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
  match: TitleMatchInfo | null;
  candidates?: PsPricesCandidate[];
}

export interface PspricesPriceRevalidationPayload extends Record<string, unknown> {
  cacheKey: string;
  igdbGameId: string;
  platformIgdbId: number;
  title?: string | null;
  psPricesUrl?: string | null;
}

// PS4 and PS5 are priced from the PlayStation Store (playstation-store-prices.ts).
const PSPRICES_PLATFORM_BY_IGDB_ID = new Map<number, string>([
  [130, 'Switch'],
  [508, 'Switch2'],
]);
const DEFAULT_PSPRICES_PRICE_CACHE_FRESH_TTL_SECONDS = 86400;
const DEFAULT_PSPRICES_PRICE_CACHE_STALE_TTL_SECONDS = 86400 * 90;
const revalidationInFlightByKey = new Map<string, Promise<void>>();
const PSPRICES_REGION_CURRENCY_BY_CODE = new Map<string, string>([
  ['ch', 'CHF'],
  ['us', 'USD'],
  ['gb', 'GBP'],
  ['jp', 'JPY'],
  ['kr', 'KRW'],
]);

export async function registerPsPricesRoute(
  app: FastifyInstance,
  pool: Pool,
  options: PsPricesRouteOptions = {}
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
    config: applyRouteRateLimit('psprices_prices'),
    handler: async (request, reply) => {
      const query = request.query as Record<string, unknown>;
      const igdbGameId = normalizeGameId(query['igdbGameId']);
      const platformIgdbId = normalizePositiveInteger(query['platformIgdbId']);
      const titleOverride = normalizeNonEmptyString(query['title']);
      const preferredPsPricesUrlOverride = normalizePreferredPsPricesUrl(
        query['preferredPsPricesUrl']
      );
      const hasTitleOverride = titleOverride !== null;
      const hasPreferredPsPricesUrlOverride = preferredPsPricesUrlOverride !== null;
      const hasLookupOverride = hasTitleOverride || hasPreferredPsPricesUrlOverride;
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
          ...(includeCandidates ? { candidates: [] } : {}),
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
          error: error instanceof Error ? error.message : String(error),
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
      const preferredPsPricesUrl =
        preferredPsPricesUrlOverride ??
        (hasTitleOverride ? null : resolvePreferredPsPricesUrl(payload));
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
          ...(includeCandidates ? { candidates: [] } : {}),
        };
        reply.code(200).send(unavailablePayload);
        return;
      }

      const cachedSnapshot = hasLookupOverride
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
            ...(includeCandidates ? { candidates: cachedSnapshot.candidates } : {}),
          };
          reply.code(200).send(cachedPayload);
          return;
        }

        if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds) {
          incrementPspricesPriceMetric('hits');
          incrementPspricesPriceMetric('staleServed');
          const scheduled = schedulePspricesPriceRevalidation({
            cacheKey: buildPspricesPriceCacheKey({
              igdbGameId,
              platformIgdbId,
              regionPath: config.pspricesRegionPath,
              show: config.pspricesShow,
              platform: pspricesPlatform,
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
            enqueueRevalidationJob: options.enqueueRevalidationJob,
          });

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
            ...(includeCandidates ? { candidates: cachedSnapshot.candidates } : {}),
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
          preferredUrl: preferredPsPricesUrl,
        });
        if (pspricesLookup.incompleteNoMatch) {
          if (!includeCandidates) {
            throw new Error(INCOMPLETE_NO_MATCH_ERROR);
          }
          // The manual picker can still choose from the candidates that came back. Nothing is
          // saved, so the next lookup searches again.
          const incompletePayload: PsPricesRouteResponse = {
            status: 'unavailable',
            igdbGameId,
            platformIgdbId,
            platform: pspricesPlatform,
            region: config.pspricesRegionPath,
            show: config.pspricesShow,
            cached: false,
            bestPrice: null,
            match: pspricesLookup.match,
            candidates: pspricesLookup.candidates,
          };
          reply.header('X-GameShelf-PSPrices-Cache', 'MISS');
          reply.code(200).send(incompletePayload);
          return;
        }
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
            matchLocked: hasLookupOverride ? true : undefined,
          });
          incrementPspricesPriceMetric('writes');
        } catch (error) {
          incrementPspricesPriceMetric('writeErrors');
          request.log.warn({
            msg: 'psprices_write_failed',
            igdbGameId,
            platformIgdbId,
            platform: pspricesPlatform,
            error: error instanceof Error ? error.message : String(error),
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
          ...(includeCandidates ? { candidates: pspricesLookup.candidates } : {}),
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
          error: error instanceof Error ? error.message : String(error),
        });
        reply.code(502).send({ error: 'Unable to fetch PSPrices data.' });
      }
    },
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
    params.platform.toLowerCase(),
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
      url: normalizeNonEmptyString(payload['psPricesUrl']),
    },
    match:
      matchQueryTitle && matchConfidence
        ? {
            queryTitle: matchQueryTitle,
            matchedTitle: matchTitle,
            score: matchScore,
            confidence: matchConfidence,
          }
        : null,
    candidates,
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
    psPricesUrl: params.preferredPsPricesUrl,
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
        preferredUrl: params.preferredPsPricesUrl,
      });
      assertSavablePsPricesLookup(pspricesLookup);

      await persistPsPricesSnapshot(params.pool, {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        payload: params.payload,
        regionPath: config.pspricesRegionPath,
        show: config.pspricesShow,
        platform: pspricesPlatform,
        bestPrice: pspricesLookup.snapshot,
        match: pspricesLookup.match,
        candidates: pspricesLookup.candidates,
      });
      incrementPspricesPriceMetric('writes');
      incrementPspricesPriceMetric('revalidateSucceeded');
    } catch (error) {
      incrementPspricesPriceMetric('revalidateFailed');
      params.request.log.warn({
        msg: 'psprices_revalidate_failed',
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

interface PsPricesLookupParams {
  title: string;
  platform: string;
  regionPath: string;
  show: string;
  preferredUrl?: string | null;
}

interface PsPricesLookup {
  snapshot: PsPricesSnapshot | null;
  match: TitleMatchInfo;
  candidates: PsPricesCandidate[];
}

interface FetchedPsPricesLookup extends PsPricesLookup {
  /**
   * The scraper flagged a failed title variant and nothing matched. The failed variant may have
   * been the one that matched, so this "no match" mustn't be saved.
   */
  incompleteNoMatch: boolean;
}

const INCOMPLETE_NO_MATCH_ERROR =
  'PSPrices search incomplete: a title variant failed and nothing matched';

/** Revalidation saves whatever it fetched, so an incomplete no-match fails it to be retried. */
function assertSavablePsPricesLookup(lookup: FetchedPsPricesLookup): void {
  if (lookup.incompleteNoMatch) {
    throw new Error(INCOMPLETE_NO_MATCH_ERROR);
  }
}

async function fetchPsPricesSnapshot(
  fetchImpl: typeof fetch,
  params: PsPricesLookupParams
): Promise<FetchedPsPricesLookup> {
  const endpoint = new URL('/v1/psprices/search', config.pspricesScraperBaseUrl);
  endpoint.searchParams.set('q', params.title);
  endpoint.searchParams.set('platform', params.platform);
  endpoint.searchParams.set('region', params.regionPath);
  endpoint.searchParams.set('show', params.show);
  endpoint.searchParams.set('includeCandidates', '1');

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (config.pspricesScraperToken.length > 0) {
    headers['Authorization'] = `Bearer ${config.pspricesScraperToken}`;
  }

  const response = await fetchWithTimeout(
    fetchImpl,
    endpoint.toString(),
    headers,
    config.pspricesScraperRequestTimeoutMs
  );
  if (!response.ok) {
    throw new Error(`PSPrices request failed with status ${String(response.status)}`);
  }

  const payload: unknown = await response.json();
  const lookup = buildPsPricesLookup(payload, params);
  return {
    ...lookup,
    incompleteNoMatch: lookup.snapshot === null && isIncompletePsPricesSearch(payload),
  };
}

function isIncompletePsPricesSearch(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>)['incomplete'] === true
  );
}

function buildPsPricesLookup(payload: unknown, params: PsPricesLookupParams): PsPricesLookup {
  const payloadRecord: Record<string, unknown> =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
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

  const preferredUrl = normalizePreferredPsPricesUrl(params.preferredUrl);
  const result = matchCandidatesByTitle(params.title, params.platform, dedupedCandidates, {
    isPreferred:
      preferredUrl === null
        ? undefined
        : (candidate) => normalizePreferredPsPricesUrl(candidate.url) === preferredUrl,
  });
  return { snapshot: result.best, match: result.match, candidates: result.candidates };
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
  const imageUrl = normalizeNonEmptyString(candidate['imageUrl']);

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
    ...(imageUrl ? { imageUrl } : {}),
    metadataQualityScore: resolveCandidateMetadataQualityScore(candidate),
  };
}

function resolveCandidateMetadataQualityScore(candidate: Record<string, unknown>): number {
  const persistedScore = normalizeNumberOrNull(candidate['metadataQualityScore']);
  if (persistedScore !== null && Number.isFinite(persistedScore)) {
    return persistedScore;
  }
  return resolveRawCandidateQualityScore(candidate);
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
    score,
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
      signal: controller.signal,
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
    match: TitleMatchInfo;
    candidates: PsPricesCandidate[];
    matchLocked?: boolean;
    retryState?: unknown;
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const { bestPrice } = params;
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
      score: candidate.score,
    })),
  };
  if (typeof params.matchLocked === 'boolean') {
    patchPayload['psPricesMatchLocked'] = params.matchLocked;
  }
  if (params.retryState !== undefined) {
    const existingRetry =
      params.payload['enrichmentRetry'] &&
      typeof params.payload['enrichmentRetry'] === 'object' &&
      !Array.isArray(params.payload['enrichmentRetry'])
        ? ({ ...(params.payload['enrichmentRetry'] as Record<string, unknown>) } as Record<
            string,
            unknown
          >)
        : {};
    const parsedRetryState = parseProviderRetryState(params.retryState);
    if (hasMeaningfulRetryState(parsedRetryState)) {
      existingRetry['psprices'] = parsedRetryState;
    } else {
      delete existingRetry['psprices'];
    }
    patchPayload['enrichmentRetry'] = Object.keys(existingRetry).length > 0 ? existingRetry : null;
  }
  if (bestPrice !== null) {
    patchPayload['priceSource'] = 'psprices';
    patchPayload['priceFetchedAt'] = fetchedAt;
    patchPayload['priceAmount'] = bestPrice.amount;
    patchPayload['priceCurrency'] = bestPrice.currency ?? null;
    patchPayload['priceRegularAmount'] = bestPrice.regularAmount ?? null;
    patchPayload['priceDiscountPercent'] = bestPrice.discountPercent ?? null;
    patchPayload['priceIsFree'] = bestPrice.isFree ?? null;
    patchPayload['priceUrl'] = bestPrice.url ?? null;
    patchPayload['psPricesTitle'] = bestPrice.title ?? null;
    patchPayload['psPricesPriceAmount'] = bestPrice.amount;
    patchPayload['psPricesPriceCurrency'] = bestPrice.currency ?? null;
    patchPayload['psPricesRegularPriceAmount'] = bestPrice.regularAmount ?? null;
    patchPayload['psPricesDiscountPercent'] = bestPrice.discountPercent ?? null;
    patchPayload['psPricesIsFree'] = bestPrice.isFree ?? null;
    patchPayload['psPricesUrl'] = bestPrice.url ?? null;
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
        nextPayload: updatedPayload,
      });
    } catch (error) {
      console.error('[psprices] wishlist_sale_notification_failed', {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        error: error instanceof Error ? error.message : String(error),
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
  const isDiscoveryGame = isDiscoveryListType(gamePayload['listType']);

  const pspricesPlatform = PSPRICES_PLATFORM_BY_IGDB_ID.get(platformIgdbId) ?? null;
  if (!pspricesPlatform) {
    throw new Error('Unsupported PSPrices platform for revalidation.');
  }

  const title =
    normalizeNonEmptyString(payload.title) ??
    normalizeNonEmptyString(gamePayload['psPricesMatchQueryTitle']) ??
    normalizeNonEmptyString(gamePayload['title']);
  const preferredPsPricesUrl =
    normalizePreferredPsPricesUrl(payload.psPricesUrl) ?? resolvePreferredPsPricesUrl(gamePayload);
  if (!title) {
    throw new Error('PSPrices revalidation missing title.');
  }

  const pspricesLookup = await fetchPsPricesSnapshot(fetch, {
    title,
    platform: pspricesPlatform,
    regionPath: config.pspricesRegionPath,
    show: config.pspricesShow,
    preferredUrl: preferredPsPricesUrl,
  });
  assertSavablePsPricesLookup(pspricesLookup);

  const retryState = isDiscoveryGame
    ? nextProviderRetryState({
        current: maybeRearmProviderRetryState({
          state: parseProviderRetryState(
            gamePayload['enrichmentRetry'] &&
              typeof gamePayload['enrichmentRetry'] === 'object' &&
              !Array.isArray(gamePayload['enrichmentRetry'])
              ? (gamePayload['enrichmentRetry'] as Record<string, unknown>)['psprices']
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
        success: pspricesLookup.snapshot !== null,
        maxAttempts: config.recommendationsDiscoveryEnrichMaxAttempts,
        backoffBaseMinutes: config.recommendationsDiscoveryEnrichBackoffBaseMinutes,
        backoffMaxHours: config.recommendationsDiscoveryEnrichBackoffMaxHours,
      })
    : null;

  await persistPsPricesSnapshot(pool, {
    igdbGameId,
    platformIgdbId,
    payload: gamePayload,
    regionPath: config.pspricesRegionPath,
    show: config.pspricesShow,
    platform: pspricesPlatform,
    bestPrice: pspricesLookup.snapshot,
    match: pspricesLookup.match,
    candidates: pspricesLookup.candidates,
    retryState: isDiscoveryGame ? retryState : null,
  });
}

export const __pspricesTestables = {
  readPsPricesSnapshotFromPayload,
  buildPspricesPriceCacheKey,
  schedulePspricesPriceRevalidation,
};
