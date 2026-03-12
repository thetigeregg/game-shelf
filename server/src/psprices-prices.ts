import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, QueryResultRow } from 'pg';
import { incrementPspricesPriceMetric } from './cache-metrics.js';
import { config } from './config.js';
import { isDiscoveryListType } from './list-type.js';
import { maybeSendWishlistSaleNotification } from './price-sale-notifications.js';

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
  amount: number | null;
  currency: string | null;
  regularAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  url: string | null;
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
}

const PSPRICES_PLATFORM_BY_IGDB_ID = new Map<number, string>([
  [48, 'PS4'],
  [167, 'PS5'],
  [130, 'Switch'],
  [508, 'Switch2']
]);
const PSPRICES_TITLE_MATCH_MIN_SCORE = 70;
const PSPRICES_TITLE_MATCH_MIN_GAP = 8;
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

      const title = titleOverride ?? normalizeNonEmptyString(payload['title']);
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
          const scheduled = schedulePspricesPriceRevalidation({
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
            fetchImpl,
            scheduleBackgroundRefresh,
            enqueueRevalidationJob: options.enqueueRevalidationJob
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
          show: config.pspricesShow
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
            candidates: pspricesLookup.candidates
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
  fetchImpl: typeof fetch;
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: PspricesPriceRevalidationPayload) => void;
}): boolean {
  const revalidationPayload: PspricesPriceRevalidationPayload = {
    cacheKey: params.cacheKey,
    igdbGameId: params.igdbGameId,
    platformIgdbId: params.platformIgdbId,
    title: params.title
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
        show: config.pspricesShow
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

  const ranked = dedupedCandidates
    .map((candidate) => ({
      candidate,
      score: scorePsPricesTitleMatch(params.title, candidate.title ?? '')
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const second = ranked[1];

  const hasHighConfidenceMatch =
    best.score >= PSPRICES_TITLE_MATCH_MIN_SCORE &&
    (ranked.length === 1 || best.score - second.score >= PSPRICES_TITLE_MATCH_MIN_GAP);

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
    amount: amount === null && isFree ? 0 : amount !== null ? round2(amount) : null,
    currency,
    regularAmount: regularAmount !== null ? round2(regularAmount) : null,
    discountPercent: discountPercent !== null ? round2(discountPercent) : null,
    isFree,
    url
  };
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

function scorePsPricesTitleMatch(expectedTitle: string, candidateTitle: string): number {
  const expected = normalizeTitleForMatchForScoring(expectedTitle);
  const candidate = normalizeTitleForMatchForScoring(candidateTitle);
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

function normalizeTitleForMatchForScoring(value: string): string {
  const normalized = normalizeTitleForMatch(value);
  // Compress edition-label phrases into single qualifier tokens so they
  // reduce score less than two separate extra tokens.
  const withoutNeutralEditionLabels = normalized.replace(
    /\bstandard edition\b/g,
    ' standard_edition '
  );
  const withCollapsedEditionLabels = withoutNeutralEditionLabels.replace(
    /\bcomplete edition\b/g,
    ' complete_edition '
  );
  const filteredTokens = withCollapsedEditionLabels.split(' ').filter((token) => token.length > 0);

  if (filteredTokens.length === 0) {
    return normalized;
  }

  return filteredTokens.join(' ');
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
      amount: candidate.amount,
      currency: candidate.currency,
      regularAmount: candidate.regularAmount,
      discountPercent: candidate.discountPercent,
      isFree: candidate.isFree,
      url: candidate.url,
      score: candidate.score
    }))
  };
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

  const updateResult = await pool.query<{ payload: unknown }>(
    `
      UPDATE games
      SET payload = games.payload || $3::jsonb, updated_at = NOW()
      WHERE igdb_game_id = $1
        AND platform_igdb_id = $2
        AND games.payload IS DISTINCT FROM (games.payload || $3::jsonb)
      RETURNING payload
    `,
    [params.igdbGameId, params.platformIgdbId, JSON.stringify(patchPayload)]
  );

  const updatedPayloadCandidate = normalizePayloadObject(updateResult.rows[0]?.payload);
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
    await maybeSendWishlistSaleNotification(pool, {
      igdbGameId: params.igdbGameId,
      platformIgdbId: params.platformIgdbId,
      previousPayload: params.payload,
      nextPayload: updatedPayload
    });
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

  const pspricesPlatform = PSPRICES_PLATFORM_BY_IGDB_ID.get(platformIgdbId) ?? null;
  if (!pspricesPlatform) {
    throw new Error('Unsupported PSPrices platform for revalidation.');
  }

  const title =
    normalizeNonEmptyString(payload.title) ?? normalizeNonEmptyString(gamePayload['title']);
  if (!title) {
    throw new Error('PSPrices revalidation missing title.');
  }

  const pspricesLookup = await fetchPsPricesSnapshot(fetch, {
    title,
    platform: pspricesPlatform,
    regionPath: config.pspricesRegionPath,
    show: config.pspricesShow
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
