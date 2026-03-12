import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, QueryResultRow } from 'pg';
import { incrementSteamPriceMetric } from './cache-metrics.js';
import { config } from './config.js';
import { isDiscoveryListType } from './list-type.js';
import { maybeSendWishlistSaleNotification } from './price-sale-notifications.js';

interface SteamPricesRouteOptions {
  fetchImpl?: typeof fetch;
  nowProvider?: () => number;
  scheduleBackgroundRefresh?: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: SteamPriceRevalidationPayload) => void;
  enableStaleWhileRevalidate?: boolean;
  freshTtlSeconds?: number;
  staleTtlSeconds?: number;
}

interface GamePayloadRow extends QueryResultRow {
  payload: unknown;
}

type SteamRouteStatus = 'ok' | 'unsupported_platform' | 'missing_steam_app_id' | 'unavailable';

interface SteamPriceSnapshot {
  amount: number | null;
  currency: string | null;
  initialAmount: number | null;
  discountPercent: number | null;
  isFree: boolean | null;
  url: string;
}

interface SteamRouteResponse {
  status: SteamRouteStatus;
  igdbGameId: string;
  platformIgdbId: number;
  cc: string;
  steamAppId: number | null;
  cached: boolean;
  bestPrice: SteamPriceSnapshot | null;
}

export interface SteamPriceRevalidationPayload {
  cacheKey: string;
  igdbGameId: string;
  platformIgdbId: number;
  cc: string;
  steamAppId: number;
}

const WINDOWS_IGDB_PLATFORM_ID = 6;
const DEFAULT_STEAM_PRICE_CACHE_FRESH_TTL_SECONDS = 86400;
const DEFAULT_STEAM_PRICE_CACHE_STALE_TTL_SECONDS = 86400 * 90;
const revalidationInFlightByKey = new Map<string, Promise<void>>();

export async function registerSteamPricesRoute(
  app: FastifyInstance,
  pool: Pool,
  options: SteamPricesRouteOptions = {}
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
    options.enableStaleWhileRevalidate ?? config.steamPriceCacheEnableStaleWhileRevalidate;
  const freshTtlSeconds = normalizeTtlSeconds(
    options.freshTtlSeconds,
    config.steamPriceCacheFreshTtlSeconds,
    DEFAULT_STEAM_PRICE_CACHE_FRESH_TTL_SECONDS
  );
  const staleTtlSeconds = Math.max(
    freshTtlSeconds,
    normalizeTtlSeconds(
      options.staleTtlSeconds,
      config.steamPriceCacheStaleTtlSeconds,
      DEFAULT_STEAM_PRICE_CACHE_STALE_TTL_SECONDS
    )
  );

  app.route({
    method: 'GET',
    url: '/v1/steam/prices',
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
      const querySteamAppIdRaw = query['steamAppId'];
      const querySteamAppId = normalizePositiveInteger(querySteamAppIdRaw);
      const cc = normalizeCountryCode(query['cc']) ?? config.steamDefaultCountry;

      if (!igdbGameId || platformIgdbId === null) {
        incrementSteamPriceMetric('invalidRequests');
        reply.code(400).send({ error: 'igdbGameId and platformIgdbId are required.' });
        return;
      }

      if (query['cc'] !== undefined && normalizeCountryCode(query['cc']) === null) {
        incrementSteamPriceMetric('invalidRequests');
        reply.code(400).send({ error: 'cc must be a two-letter ISO country code.' });
        return;
      }
      if (querySteamAppIdRaw !== undefined && querySteamAppId === null) {
        incrementSteamPriceMetric('invalidRequests');
        reply.code(400).send({ error: 'steamAppId must be a positive integer.' });
        return;
      }

      if (platformIgdbId !== WINDOWS_IGDB_PLATFORM_ID) {
        const unsupportedPayload: SteamRouteResponse = {
          status: 'unsupported_platform',
          igdbGameId,
          platformIgdbId,
          cc,
          steamAppId: null,
          cached: false,
          bestPrice: null
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
        incrementSteamPriceMetric('readErrors');
        request.log.warn({
          msg: 'steam_prices_read_failed',
          igdbGameId,
          platformIgdbId,
          error: error instanceof Error ? error.message : String(error)
        });
        reply.code(502).send({ error: 'Unable to read game pricing state.' });
        return;
      }

      if (!payload && querySteamAppId === null) {
        reply.code(404).send({ error: 'Game not found.' });
        return;
      }

      const steamAppId = querySteamAppId ?? normalizePositiveInteger(payload?.['steamAppId']);
      if (steamAppId === null) {
        const missingPayload: SteamRouteResponse = {
          status: 'missing_steam_app_id',
          igdbGameId,
          platformIgdbId,
          cc,
          steamAppId: null,
          cached: false,
          bestPrice: null
        };
        reply.code(200).send(missingPayload);
        return;
      }

      const payloadSteamAppId = normalizePositiveInteger(payload?.['steamAppId']);
      const canUsePayloadCache =
        payload !== null &&
        (querySteamAppId === null ||
          (payloadSteamAppId !== null && payloadSteamAppId === steamAppId));
      const cachedSnapshot = canUsePayloadCache ? readSteamSnapshotFromPayload(payload, cc) : null;
      if (cachedSnapshot) {
        const ageSeconds = getAgeSeconds(cachedSnapshot.fetchedAt, nowProvider());

        if (ageSeconds <= freshTtlSeconds) {
          incrementSteamPriceMetric('hits');
          reply.header('X-GameShelf-Steam-Price-Cache', 'HIT_FRESH');
          const cachedStatus: SteamRouteStatus = isAvailableSnapshot(cachedSnapshot.snapshot)
            ? 'ok'
            : 'unavailable';
          const cachedPayload: SteamRouteResponse = {
            status: cachedStatus,
            igdbGameId,
            platformIgdbId,
            cc,
            steamAppId,
            cached: true,
            bestPrice: cachedSnapshot.snapshot
          };
          reply.code(200).send(cachedPayload);
          return;
        }

        if (enableStaleWhileRevalidate && ageSeconds <= staleTtlSeconds && payload) {
          incrementSteamPriceMetric('hits');
          incrementSteamPriceMetric('staleServed');
          const scheduled = scheduleSteamPriceRevalidation({
            cacheKey: buildSteamPriceCacheKey({ igdbGameId, platformIgdbId, cc, steamAppId }),
            request,
            pool,
            payload,
            igdbGameId,
            platformIgdbId,
            cc,
            steamAppId,
            fetchImpl,
            scheduleBackgroundRefresh,
            enqueueRevalidationJob: options.enqueueRevalidationJob
          });

          reply.header('X-GameShelf-Steam-Price-Cache', 'HIT_STALE');
          reply.header('X-GameShelf-Steam-Price-Revalidate', scheduled ? 'scheduled' : 'skipped');

          const staleStatus: SteamRouteStatus = isAvailableSnapshot(cachedSnapshot.snapshot)
            ? 'ok'
            : 'unavailable';
          const stalePayload: SteamRouteResponse = {
            status: staleStatus,
            igdbGameId,
            platformIgdbId,
            cc,
            steamAppId,
            cached: true,
            bestPrice: cachedSnapshot.snapshot
          };
          reply.code(200).send(stalePayload);
          return;
        }
      }

      incrementSteamPriceMetric('misses');
      try {
        const steamSnapshot = await fetchSteamPriceSnapshot(fetchImpl, steamAppId, cc);
        if (payload) {
          try {
            await persistSteamSnapshot(pool, {
              igdbGameId,
              platformIgdbId,
              payload,
              cc,
              steamAppId,
              bestPrice: steamSnapshot
            });
            incrementSteamPriceMetric('writes');
          } catch (error) {
            incrementSteamPriceMetric('writeErrors');
            request.log.warn({
              msg: 'steam_prices_write_failed',
              igdbGameId,
              platformIgdbId,
              steamAppId,
              cc,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        const routeStatus: SteamRouteStatus = steamSnapshot ? 'ok' : 'unavailable';
        const responsePayload: SteamRouteResponse = {
          status: routeStatus,
          igdbGameId,
          platformIgdbId,
          cc,
          steamAppId,
          cached: false,
          bestPrice: steamSnapshot
        };
        reply.header('X-GameShelf-Steam-Price-Cache', 'MISS');
        reply.code(200).send(responsePayload);
      } catch (error) {
        incrementSteamPriceMetric('upstreamErrors');
        request.log.warn({
          msg: 'steam_prices_fetch_failed',
          igdbGameId,
          platformIgdbId,
          steamAppId,
          cc,
          error: error instanceof Error ? error.message : String(error)
        });
        reply.code(502).send({ error: 'Unable to fetch Steam prices.' });
      }
    }
  });
}

function buildSteamPriceCacheKey(params: {
  igdbGameId: string;
  platformIgdbId: number;
  cc: string;
  steamAppId: number;
}): string {
  return [
    params.igdbGameId,
    String(params.platformIgdbId),
    params.cc.toUpperCase(),
    String(params.steamAppId)
  ].join(':');
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

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asMoneyFromMinorUnits(value: unknown): number | null {
  const minor = normalizeNumberOrNull(value);
  if (minor === null) {
    return null;
  }
  return round2(minor / 100);
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

function readSteamSnapshotFromPayload(
  payload: Record<string, unknown>,
  countryCode: string
): { fetchedAt: string; snapshot: SteamPriceSnapshot } | null {
  const fetchedAt = normalizeNonEmptyString(payload['steamPriceFetchedAt']);
  const cachedCountry = normalizeCountryCode(payload['steamPriceCountry']);
  if (!fetchedAt || cachedCountry !== countryCode) {
    return null;
  }

  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return null;
  }

  const amount = normalizeNumberOrNull(payload['steamPriceAmount']);
  const currency = normalizeNonEmptyString(payload['steamPriceCurrency']);
  const initialAmount = normalizeNumberOrNull(payload['steamPriceInitialAmount']);
  const discountPercent = normalizeNumberOrNull(payload['steamPriceDiscountPercent']);
  const isFree = normalizeBooleanOrNull(payload['steamPriceIsFree']);
  const url =
    normalizeNonEmptyString(payload['steamPriceUrl']) ??
    buildSteamAppUrl(normalizePositiveInteger(payload['steamAppId']) ?? 0);

  return {
    fetchedAt,
    snapshot: {
      amount,
      currency,
      initialAmount,
      discountPercent,
      isFree,
      url
    }
  };
}

function isAvailableSnapshot(snapshot: SteamPriceSnapshot): boolean {
  return snapshot.amount !== null || snapshot.isFree === true;
}

function scheduleSteamPriceRevalidation(params: {
  cacheKey: string;
  request: FastifyRequest;
  pool: Pool;
  payload: Record<string, unknown>;
  igdbGameId: string;
  platformIgdbId: number;
  cc: string;
  steamAppId: number;
  fetchImpl: typeof fetch;
  scheduleBackgroundRefresh: (task: () => Promise<void>) => void;
  enqueueRevalidationJob?: (payload: SteamPriceRevalidationPayload) => void;
}): boolean {
  const revalidationPayload: SteamPriceRevalidationPayload = {
    cacheKey: params.cacheKey,
    igdbGameId: params.igdbGameId,
    platformIgdbId: params.platformIgdbId,
    cc: params.cc,
    steamAppId: params.steamAppId
  };

  if (params.enqueueRevalidationJob) {
    incrementSteamPriceMetric('revalidateScheduled');
    params.enqueueRevalidationJob(revalidationPayload);
    return true;
  }

  if (revalidationInFlightByKey.has(params.cacheKey)) {
    incrementSteamPriceMetric('revalidateSkipped');
    return false;
  }

  incrementSteamPriceMetric('revalidateScheduled');

  let resolveDone: (() => void) | null = null;
  const inFlight = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  revalidationInFlightByKey.set(params.cacheKey, inFlight);

  params.scheduleBackgroundRefresh(async () => {
    try {
      const steamSnapshot = await fetchSteamPriceSnapshot(
        params.fetchImpl,
        params.steamAppId,
        params.cc
      );
      await persistSteamSnapshot(params.pool, {
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        payload: params.payload,
        cc: params.cc,
        steamAppId: params.steamAppId,
        bestPrice: steamSnapshot
      });
      incrementSteamPriceMetric('writes');
      incrementSteamPriceMetric('revalidateSucceeded');
    } catch (error) {
      incrementSteamPriceMetric('revalidateFailed');
      params.request.log.warn({
        msg: 'steam_prices_revalidate_failed',
        igdbGameId: params.igdbGameId,
        platformIgdbId: params.platformIgdbId,
        steamAppId: params.steamAppId,
        cc: params.cc,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      revalidationInFlightByKey.delete(params.cacheKey);
      resolveDone?.();
    }
  });

  return true;
}

async function fetchSteamPriceSnapshot(
  fetchImpl: typeof fetch,
  steamAppId: number,
  countryCode: string
): Promise<SteamPriceSnapshot | null> {
  const endpoint = new URL('/api/appdetails', config.steamStoreApiBaseUrl);
  endpoint.searchParams.set('appids', String(steamAppId));
  endpoint.searchParams.set('cc', countryCode.toLowerCase());
  endpoint.searchParams.set('filters', 'price_overview,is_free');

  const response = await fetchWithTimeout(
    fetchImpl,
    endpoint.toString(),
    config.steamStoreApiTimeoutMs
  );
  if (!response.ok) {
    throw new Error(`Steam request failed with status ${String(response.status)}`);
  }

  const payload: unknown = await response.json();
  const appRecord = extractSteamAppRecord(payload, steamAppId);
  if (!appRecord) {
    return null;
  }

  const success = appRecord['success'];
  if (success !== true) {
    return null;
  }

  const data =
    appRecord['data'] && typeof appRecord['data'] === 'object' && !Array.isArray(appRecord['data'])
      ? (appRecord['data'] as Record<string, unknown>)
      : null;

  if (!data) {
    return null;
  }

  const priceOverview =
    data['price_overview'] &&
    typeof data['price_overview'] === 'object' &&
    !Array.isArray(data['price_overview'])
      ? (data['price_overview'] as Record<string, unknown>)
      : null;

  const isFree = normalizeBooleanOrNull(data['is_free']);
  const currency = normalizeNonEmptyString(priceOverview?.['currency']);
  const amount = asMoneyFromMinorUnits(priceOverview?.['final']);
  const initialAmount = asMoneyFromMinorUnits(priceOverview?.['initial']);
  const discountPercent = normalizeNumberOrNull(priceOverview?.['discount_percent']);

  if (!priceOverview && isFree !== true) {
    return null;
  }

  return {
    amount: isFree === true ? 0 : amount,
    currency,
    initialAmount: isFree === true ? 0 : initialAmount,
    discountPercent: isFree === true ? 0 : discountPercent,
    isFree,
    url: buildSteamAppUrl(steamAppId)
  };
}

function extractSteamAppRecord(value: unknown, steamAppId: number): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const direct = payload[String(steamAppId)];
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  return null;
}

function buildSteamAppUrl(steamAppId: number): string {
  return `https://store.steampowered.com/app/${String(steamAppId)}`;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function persistSteamSnapshot(
  pool: Pool,
  params: {
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
    cc: string;
    steamAppId: number;
    bestPrice: SteamPriceSnapshot | null;
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const preserveExisting = params.bestPrice === null;
  const patchPayload: Record<string, unknown> = {
    steamAppId: params.steamAppId,
    steamPriceCountry: params.cc,
    steamPriceFetchedAt: fetchedAt,
    steamPriceSource: 'steam_store'
  };
  if (preserveExisting) {
    patchPayload['steamPriceUrl'] =
      params.payload['steamPriceUrl'] ?? buildSteamAppUrl(params.steamAppId);
  } else {
    patchPayload['priceSource'] = 'steam_store';
    patchPayload['priceFetchedAt'] = fetchedAt;
    patchPayload['priceAmount'] = params.bestPrice.amount;
    patchPayload['priceCurrency'] = params.bestPrice.currency ?? null;
    patchPayload['priceRegularAmount'] = params.bestPrice.initialAmount ?? null;
    patchPayload['priceDiscountPercent'] = params.bestPrice.discountPercent ?? null;
    patchPayload['priceIsFree'] = params.bestPrice.isFree ?? null;
    patchPayload['priceUrl'] = params.bestPrice.url;
    patchPayload['steamPriceUrl'] = params.bestPrice.url;
    patchPayload['steamPriceAmount'] = params.bestPrice.amount;
    patchPayload['steamPriceCurrency'] = params.bestPrice.currency ?? null;
    patchPayload['steamPriceInitialAmount'] = params.bestPrice.initialAmount ?? null;
    patchPayload['steamPriceDiscountPercent'] = params.bestPrice.discountPercent ?? null;
    patchPayload['steamPriceIsFree'] = params.bestPrice.isFree ?? null;
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

export async function processQueuedSteamPriceRevalidation(
  pool: Pool,
  payload: SteamPriceRevalidationPayload
): Promise<void> {
  const igdbGameId = normalizeGameId(payload.igdbGameId);
  const platformIgdbId = normalizePositiveInteger(payload.platformIgdbId);
  const steamAppId = normalizePositiveInteger(payload.steamAppId);
  const cc = normalizeCountryCode(payload.cc);

  if (!igdbGameId || platformIgdbId === null || steamAppId === null || cc === null) {
    throw new Error('Invalid steam price revalidation payload.');
  }

  const row = await pool.query<GamePayloadRow>(
    'SELECT payload FROM games WHERE igdb_game_id = $1 AND platform_igdb_id = $2 LIMIT 1',
    [igdbGameId, platformIgdbId]
  );
  const gamePayload = normalizePayloadObject(row.rows[0]?.payload);
  if (!gamePayload) {
    throw new Error('Steam price revalidation game row not found.');
  }

  const steamSnapshot = await fetchSteamPriceSnapshot(fetch, steamAppId, cc);
  await persistSteamSnapshot(pool, {
    igdbGameId,
    platformIgdbId,
    payload: gamePayload,
    cc,
    steamAppId,
    bestPrice: steamSnapshot
  });
}

export const __steamPriceTestables = {
  normalizeCountryCode,
  normalizePositiveInteger,
  readSteamSnapshotFromPayload,
  fetchSteamPriceSnapshot,
  extractSteamAppRecord,
  scheduleSteamPriceRevalidation,
  buildSteamPriceCacheKey
};
