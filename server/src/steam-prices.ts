import type { FastifyInstance } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, QueryResultRow } from 'pg';
import { config } from './config.js';

interface SteamPricesRouteOptions {
  fetchImpl?: typeof fetch;
  nowProvider?: () => number;
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

const WINDOWS_IGDB_PLATFORM_ID = 6;

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
        reply.code(400).send({ error: 'igdbGameId and platformIgdbId are required.' });
        return;
      }

      if (query['cc'] !== undefined && normalizeCountryCode(query['cc']) === null) {
        reply.code(400).send({ error: 'cc must be a two-letter ISO country code.' });
        return;
      }
      if (querySteamAppIdRaw !== undefined && querySteamAppId === null) {
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

      const row = await pool.query<GamePayloadRow>(
        'SELECT payload FROM games WHERE igdb_game_id = $1 AND platform_igdb_id = $2 LIMIT 1',
        [igdbGameId, platformIgdbId]
      );
      const payload = normalizePayloadObject(row.rows[0]?.payload);

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

      const cachedSnapshot = payload ? readCachedSteamSnapshot(payload, cc, nowProvider()) : null;
      if (cachedSnapshot) {
        const cachedStatus: SteamRouteStatus = isAvailableSnapshot(cachedSnapshot)
          ? 'ok'
          : 'unavailable';
        const cachedPayload: SteamRouteResponse = {
          status: cachedStatus,
          igdbGameId,
          platformIgdbId,
          cc,
          steamAppId,
          cached: true,
          bestPrice: cachedSnapshot
        };
        reply.code(200).send(cachedPayload);
        return;
      }

      try {
        const steamSnapshot = await fetchSteamPriceSnapshot(fetchImpl, steamAppId, cc);
        if (payload) {
          await persistSteamSnapshot(pool, {
            igdbGameId,
            platformIgdbId,
            payload,
            cc,
            steamAppId,
            bestPrice: steamSnapshot
          });
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
        reply.code(200).send(responsePayload);
      } catch (error) {
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

function readCachedSteamSnapshot(
  payload: Record<string, unknown>,
  countryCode: string,
  nowMs: number
): SteamPriceSnapshot | null {
  const fetchedAt = normalizeNonEmptyString(payload['steamPriceFetchedAt']);
  const cachedCountry = normalizeCountryCode(payload['steamPriceCountry']);
  if (!fetchedAt || cachedCountry !== countryCode) {
    return null;
  }

  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    return null;
  }

  const maxAgeMs = config.steamPriceCacheTtlHours * 60 * 60 * 1000;
  if (nowMs - fetchedAtMs > maxAgeMs) {
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
    amount,
    currency,
    initialAmount,
    discountPercent,
    isFree,
    url
  };
}

function isAvailableSnapshot(snapshot: SteamPriceSnapshot): boolean {
  return snapshot.amount !== null || snapshot.isFree === true;
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
  const nextPayload: Record<string, unknown> = {
    ...params.payload,
    steamAppId: params.steamAppId,
    priceSource: preserveExisting ? (params.payload['priceSource'] ?? null) : 'steam_store',
    priceFetchedAt: fetchedAt,
    priceAmount: preserveExisting
      ? (params.payload['priceAmount'] ?? null)
      : params.bestPrice.amount,
    priceCurrency: preserveExisting
      ? (params.payload['priceCurrency'] ?? null)
      : (params.bestPrice.currency ?? null),
    priceRegularAmount: preserveExisting
      ? (params.payload['priceRegularAmount'] ?? null)
      : (params.bestPrice.initialAmount ?? null),
    priceDiscountPercent: preserveExisting
      ? (params.payload['priceDiscountPercent'] ?? null)
      : (params.bestPrice.discountPercent ?? null),
    priceIsFree: preserveExisting
      ? (params.payload['priceIsFree'] ?? null)
      : (params.bestPrice.isFree ?? null),
    priceUrl: preserveExisting
      ? (params.payload['priceUrl'] ?? buildSteamAppUrl(params.steamAppId))
      : params.bestPrice.url,
    steamPriceCountry: params.cc,
    steamPriceFetchedAt: fetchedAt,
    steamPriceSource: 'steam_store',
    steamPriceUrl: preserveExisting
      ? (params.payload['steamPriceUrl'] ?? buildSteamAppUrl(params.steamAppId))
      : params.bestPrice.url,
    steamPriceAmount: preserveExisting
      ? (params.payload['steamPriceAmount'] ?? null)
      : params.bestPrice.amount,
    steamPriceCurrency: preserveExisting
      ? (params.payload['steamPriceCurrency'] ?? null)
      : (params.bestPrice.currency ?? null),
    steamPriceInitialAmount: preserveExisting
      ? (params.payload['steamPriceInitialAmount'] ?? null)
      : (params.bestPrice.initialAmount ?? null),
    steamPriceDiscountPercent: preserveExisting
      ? (params.payload['steamPriceDiscountPercent'] ?? null)
      : (params.bestPrice.discountPercent ?? null),
    steamPriceIsFree: preserveExisting
      ? (params.payload['steamPriceIsFree'] ?? null)
      : (params.bestPrice.isFree ?? null)
  };

  await pool.query(
    `
      UPDATE games
      SET payload = $3::jsonb, updated_at = NOW()
      WHERE igdb_game_id = $1
        AND platform_igdb_id = $2
        AND payload IS DISTINCT FROM $3::jsonb
    `,
    [params.igdbGameId, params.platformIgdbId, JSON.stringify(nextPayload)]
  );
}

export const __steamPriceTestables = {
  normalizeCountryCode,
  normalizePositiveInteger,
  readCachedSteamSnapshot,
  fetchSteamPriceSnapshot,
  extractSteamAppRecord
};
