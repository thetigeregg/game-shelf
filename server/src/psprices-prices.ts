import type { FastifyInstance } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, QueryResultRow } from 'pg';
import { config } from './config.js';

interface PsPricesRouteOptions {
  fetchImpl?: typeof fetch;
  nowProvider?: () => number;
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

interface PsPricesRouteResponse {
  status: PsPricesRouteStatus;
  igdbGameId: string;
  platformIgdbId: number;
  platform: string | null;
  region: string;
  show: string;
  cached: boolean;
  bestPrice: PsPricesSnapshot | null;
}

const PSPRICES_PLATFORM_BY_IGDB_ID = new Map<number, string>([
  [48, 'PS4'],
  [167, 'PS5'],
  [130, 'Switch'],
  [508, 'Switch2']
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

      if (!igdbGameId || platformIgdbId === null) {
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

      if (!payload) {
        reply.code(404).send({ error: 'Game not found.' });
        return;
      }

      const title = normalizeNonEmptyString(payload['title']);
      if (!title) {
        const unavailablePayload: PsPricesRouteResponse = {
          status: 'unavailable',
          igdbGameId,
          platformIgdbId,
          platform: pspricesPlatform,
          region: config.pspricesRegionPath,
          show: config.pspricesShow,
          cached: false,
          bestPrice: null
        };
        reply.code(200).send(unavailablePayload);
        return;
      }

      const cachedSnapshot = readCachedPsPricesSnapshot(
        payload,
        config.pspricesRegionPath,
        config.pspricesShow,
        pspricesPlatform,
        nowProvider()
      );
      if (cachedSnapshot) {
        const cachedStatus: PsPricesRouteStatus = isAvailableSnapshot(cachedSnapshot)
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
          bestPrice: cachedSnapshot
        };
        reply.code(200).send(cachedPayload);
        return;
      }

      try {
        const pspricesSnapshot = await fetchPsPricesSnapshot(fetchImpl, {
          title,
          platform: pspricesPlatform,
          regionPath: config.pspricesRegionPath,
          show: config.pspricesShow
        });

        await persistPsPricesSnapshot(pool, {
          igdbGameId,
          platformIgdbId,
          payload,
          regionPath: config.pspricesRegionPath,
          show: config.pspricesShow,
          platform: pspricesPlatform,
          bestPrice: pspricesSnapshot
        });

        const routeStatus: PsPricesRouteStatus = pspricesSnapshot ? 'ok' : 'unavailable';
        const responsePayload: PsPricesRouteResponse = {
          status: routeStatus,
          igdbGameId,
          platformIgdbId,
          platform: pspricesPlatform,
          region: config.pspricesRegionPath,
          show: config.pspricesShow,
          cached: false,
          bestPrice: pspricesSnapshot
        };
        reply.code(200).send(responsePayload);
      } catch (error) {
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

function normalizeBooleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function readCachedPsPricesSnapshot(
  payload: Record<string, unknown>,
  regionPath: string,
  show: string,
  platform: string,
  nowMs: number
): PsPricesSnapshot | null {
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

  const maxAgeMs = config.pspricesPriceCacheTtlHours * 60 * 60 * 1000;
  if (nowMs - fetchedAtMs > maxAgeMs) {
    return null;
  }

  return {
    title: normalizeNonEmptyString(payload['psPricesTitle']),
    amount: normalizeNumberOrNull(payload['psPricesPriceAmount']),
    currency: normalizeNonEmptyString(payload['psPricesPriceCurrency']),
    regularAmount: normalizeNumberOrNull(payload['psPricesRegularPriceAmount']),
    discountPercent: normalizeNumberOrNull(payload['psPricesDiscountPercent']),
    isFree: normalizeBooleanOrNull(payload['psPricesIsFree']),
    url: normalizeNonEmptyString(payload['psPricesUrl'])
  };
}

function isAvailableSnapshot(snapshot: PsPricesSnapshot): boolean {
  return snapshot.amount !== null || snapshot.isFree === true;
}

async function fetchPsPricesSnapshot(
  fetchImpl: typeof fetch,
  params: {
    title: string;
    platform: string;
    regionPath: string;
    show: string;
  }
): Promise<PsPricesSnapshot | null> {
  const endpoint = new URL('/v1/psprices/search', config.pspricesScraperBaseUrl);
  endpoint.searchParams.set('q', params.title);
  endpoint.searchParams.set('platform', params.platform);
  endpoint.searchParams.set('region', params.regionPath);
  endpoint.searchParams.set('show', params.show);

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
    return null;
  }

  const item = (payload as { item?: unknown }).item;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  const title = normalizeNonEmptyString(candidate['title']);
  const amount = normalizeNumberOrNull(candidate['priceAmount'] ?? candidate['amount']);
  const currency = normalizeNonEmptyString(candidate['currency']);
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
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const nextPayload: Record<string, unknown> = {
    ...params.payload,
    priceSource: 'psprices',
    priceFetchedAt: fetchedAt,
    priceAmount: params.bestPrice?.amount ?? null,
    priceCurrency: params.bestPrice?.currency ?? null,
    priceRegularAmount: params.bestPrice?.regularAmount ?? null,
    priceDiscountPercent: params.bestPrice?.discountPercent ?? null,
    priceIsFree: params.bestPrice?.isFree ?? null,
    priceUrl: params.bestPrice?.url ?? null,
    psPricesFetchedAt: fetchedAt,
    psPricesSource: 'psprices',
    psPricesRegionPath: params.regionPath,
    psPricesShow: params.show,
    psPricesPlatform: params.platform,
    psPricesTitle: params.bestPrice?.title ?? null,
    psPricesPriceAmount: params.bestPrice?.amount ?? null,
    psPricesPriceCurrency: params.bestPrice?.currency ?? null,
    psPricesRegularPriceAmount: params.bestPrice?.regularAmount ?? null,
    psPricesDiscountPercent: params.bestPrice?.discountPercent ?? null,
    psPricesIsFree: params.bestPrice?.isFree ?? null,
    psPricesUrl: params.bestPrice?.url ?? null
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

export const __pspricesTestables = {
  readCachedPsPricesSnapshot
};
