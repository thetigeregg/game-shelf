import type { FastifyInstance } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, QueryResultRow } from 'pg';
import { config } from './config.js';

interface ItadPricesRouteOptions {
  fetchImpl?: typeof fetch;
  nowProvider?: () => number;
}

interface GamePayloadRow extends QueryResultRow {
  payload: unknown;
}

type MatchStrategy = 'steam' | 'title' | 'none';
type ItadRouteStatus = 'ok' | 'unsupported_platform' | 'unmatched';

interface ItadRouteResponse {
  status: ItadRouteStatus;
  igdbGameId: string;
  platformIgdbId: number;
  country: string;
  steamAppId: number | null;
  itadGameId: string | null;
  matchStrategy: MatchStrategy;
  bestPrice: Record<string, unknown> | null;
  historyLow: unknown;
  deals: unknown[];
}

interface ItadPriceRow {
  id: string;
  historyLow: unknown;
  deals: unknown[];
}

interface BestSteamPrice {
  amount: number;
  currency: string | null;
  regularAmount: number | null;
  cut: number | null;
  shopId: number | null;
  shopName: string | null;
  url: string | null;
  expiry: string | null;
  platforms: unknown[];
}

const WINDOWS_IGDB_PLATFORM_ID = 6;
const WINDOWS_ITAD_PLATFORM_ID = 1;
const REQUIRED_PRICE_CURRENCY = 'EUR';
const CHF_CURRENCY_CODE = 'CHF';
const ITAD_GAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEAM_APP_URL_PATTERN = /store\.steampowered\.com\/app\/(\d+)/i;
const exchangeRateDailyCache = new Map<string, { dayKey: string; rateToChf: number }>();

export async function registerItadPricesRoute(
  app: FastifyInstance,
  pool: Pool,
  options: ItadPricesRouteOptions = {}
): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, { global: false });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const nowProvider = options.nowProvider ?? (() => Date.now());

  app.route({
    method: 'GET',
    url: '/v1/itad/prices',
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
      const country = normalizeCountryCode(query['country']) ?? config.itadDefaultCountry;
      const dealsOnly = normalizeBooleanQuery(query['dealsOnly']);
      const vouchers = normalizeBooleanQuery(query['vouchers']);

      if (!igdbGameId || platformIgdbId === null) {
        reply.code(400).send({ error: 'igdbGameId and platformIgdbId are required.' });
        return;
      }

      if (query['country'] !== undefined && normalizeCountryCode(query['country']) === null) {
        reply.code(400).send({ error: 'country must be a two-letter ISO code.' });
        return;
      }

      if (platformIgdbId !== WINDOWS_IGDB_PLATFORM_ID) {
        const payload: ItadRouteResponse = {
          status: 'unsupported_platform',
          igdbGameId,
          platformIgdbId,
          country,
          steamAppId: null,
          itadGameId: null,
          matchStrategy: 'none',
          bestPrice: null,
          historyLow: null,
          deals: []
        };
        reply.code(200).send(payload);
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

      const steamAppId = normalizePositiveInteger(payload['steamAppId']);
      const title =
        normalizeNonEmptyString(query['title']) ?? normalizeNonEmptyString(payload['title']);

      let itadGameId: string | null = null;
      let matchStrategy: MatchStrategy = 'none';

      try {
        if (steamAppId !== null) {
          itadGameId = await lookupItadGameIdBySteamAppId(fetchImpl, steamAppId);
          if (itadGameId) {
            matchStrategy = 'steam';
          }
        }

        if (!itadGameId && title) {
          itadGameId = await lookupItadGameIdByTitle(fetchImpl, title);
          if (itadGameId) {
            matchStrategy = 'title';
          }
        }

        if (!itadGameId) {
          const unmatched: ItadRouteResponse = {
            status: 'unmatched',
            igdbGameId,
            platformIgdbId,
            country,
            steamAppId,
            itadGameId: null,
            matchStrategy: 'none',
            bestPrice: null,
            historyLow: null,
            deals: []
          };
          await persistItadSnapshot(pool, {
            igdbGameId,
            platformIgdbId,
            payload,
            country,
            itadGameId: null,
            bestPrice: null
          });
          reply.code(200).send(unmatched);
          return;
        }

        const prices = await fetchItadPrices(fetchImpl, [itadGameId], {
          country,
          dealsOnly,
          vouchers
        });
        const priceRow = prices.find((item) => item.id === itadGameId) ?? null;
        const filteredDeals = (priceRow?.deals ?? []).filter(
          (deal) => isSteamShopDeal(deal) && isWindowsDeal(deal) && isRequiredCurrencyDeal(deal)
        );
        const bestPrice = selectBestSteamPrice(filteredDeals);
        const converted = await convertPricingSnapshotToChf(
          fetchImpl,
          {
            historyLow: priceRow?.historyLow ?? null,
            deals: filteredDeals,
            bestPrice
          },
          nowProvider()
        );

        await persistItadSnapshot(pool, {
          igdbGameId,
          platformIgdbId,
          payload,
          country,
          itadGameId,
          bestPrice: converted.bestPrice
        });

        const okPayload: ItadRouteResponse = {
          status: 'ok',
          igdbGameId,
          platformIgdbId,
          country,
          steamAppId,
          itadGameId,
          matchStrategy,
          bestPrice: converted.bestPrice ? serializeBestSteamPrice(converted.bestPrice) : null,
          historyLow: converted.historyLow,
          deals: converted.deals
        };
        reply.code(200).send(okPayload);
      } catch (error) {
        request.log.warn({
          msg: 'itad_prices_fetch_failed',
          igdbGameId,
          platformIgdbId,
          matchStrategy,
          error: error instanceof Error ? error.message : String(error)
        });
        reply.code(502).send({ error: 'Unable to fetch ITAD prices.' });
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

function normalizeBooleanQuery(value: unknown): boolean | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no') {
    return false;
  }
  return null;
}

function isWindowsDeal(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const platforms = Array.isArray((value as Record<string, unknown>)['platforms'])
    ? ((value as Record<string, unknown>)['platforms'] as unknown[])
    : [];

  return platforms.some((platform) => {
    if (!platform || typeof platform !== 'object') {
      return false;
    }
    const record = platform as Record<string, unknown>;
    const id = normalizePositiveInteger(record['id']);
    const name = normalizeNonEmptyString(record['name']);
    return (
      id === WINDOWS_ITAD_PLATFORM_ID ||
      (typeof name === 'string' && name.toLowerCase() === 'windows')
    );
  });
}

function isSteamShopDeal(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const shop = (value as Record<string, unknown>)['shop'];
  if (!shop || typeof shop !== 'object') {
    return false;
  }

  const shopId = normalizePositiveInteger((shop as Record<string, unknown>)['id']);
  if (shopId === config.itadSteamShopId) {
    return true;
  }

  const shopName = normalizeNonEmptyString((shop as Record<string, unknown>)['name']);
  return typeof shopName === 'string' && shopName.toLowerCase() === 'steam';
}

function isRequiredCurrencyDeal(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const price =
    (value as Record<string, unknown>)['price'] &&
    typeof (value as Record<string, unknown>)['price'] === 'object'
      ? ((value as Record<string, unknown>)['price'] as Record<string, unknown>)
      : null;

  const currency = normalizeNonEmptyString(price?.['currency']);
  return typeof currency === 'string' && currency.toUpperCase() === REQUIRED_PRICE_CURRENCY;
}

async function lookupItadGameIdBySteamAppId(
  fetchImpl: typeof fetch,
  steamAppId: number
): Promise<string | null> {
  const url = new URL(
    `/lookup/id/shop/${String(config.itadSteamShopId)}/v1`,
    config.itadApiBaseUrl
  );
  url.searchParams.set('key', config.itadApiKey);
  const payload = await postItadJson(fetchImpl, url, [`app/${String(steamAppId)}`]);
  return extractFirstItadGameId(payload);
}

async function lookupItadGameIdByTitle(
  fetchImpl: typeof fetch,
  title: string
): Promise<string | null> {
  const url = new URL('/lookup/id/title/v1', config.itadApiBaseUrl);
  url.searchParams.set('key', config.itadApiKey);
  const payload = await postItadJson(fetchImpl, url, [title]);
  return extractFirstItadGameId(payload);
}

async function fetchItadPrices(
  fetchImpl: typeof fetch,
  gameIds: string[],
  options: {
    country: string;
    dealsOnly: boolean | null;
    vouchers: boolean | null;
  }
): Promise<ItadPriceRow[]> {
  const url = new URL('/games/prices/v3', config.itadApiBaseUrl);
  url.searchParams.set('key', config.itadApiKey);
  url.searchParams.set('country', options.country);

  if (options.dealsOnly !== null) {
    url.searchParams.set('deals', options.dealsOnly ? 'true' : 'false');
  }

  if (options.vouchers !== null) {
    url.searchParams.set('vouchers', options.vouchers ? 'true' : 'false');
  }

  url.searchParams.set('shops', String(config.itadSteamShopId));

  const payload = await postItadJson(fetchImpl, url, gameIds);
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = normalizeNonEmptyString(record['id']);
      if (!id) {
        return null;
      }

      return {
        id,
        historyLow: record['historyLow'] ?? null,
        deals: Array.isArray(record['deals']) ? (record['deals'] as unknown[]) : []
      } satisfies ItadPriceRow;
    })
    .filter((entry): entry is ItadPriceRow => entry !== null);
}

function selectBestSteamPrice(deals: unknown[]): BestSteamPrice | null {
  let best: BestSteamPrice | null = null;

  for (const deal of deals) {
    if (!deal || typeof deal !== 'object') {
      continue;
    }

    const record = deal as Record<string, unknown>;
    const price = normalizePriceRecord(record['price'], record['regular']);
    if (!price) {
      continue;
    }

    if (!best || price.amount < best.amount) {
      const shop =
        record['shop'] && typeof record['shop'] === 'object'
          ? (record['shop'] as Record<string, unknown>)
          : {};
      best = {
        amount: price.amount,
        currency: price.currency,
        regularAmount: price.regularAmount,
        cut: normalizeNumberOrNull(price.cut),
        shopId: normalizePositiveInteger(shop['id']),
        shopName: normalizeNonEmptyString(shop['name']),
        url: normalizeNonEmptyString(record['url']),
        expiry: normalizeNonEmptyString(record['expiry']),
        platforms: Array.isArray(record['platforms']) ? (record['platforms'] as unknown[]) : []
      };
    }
  }

  return best;
}

function normalizePriceRecord(
  value: unknown,
  regularValue: unknown
): {
  amount: number;
  currency: string | null;
  regularAmount: number | null;
  cut: number | null;
} | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const amount = normalizeNumberOrNull(record['amount']);
  if (amount === null || amount <= 0) {
    return null;
  }

  return {
    amount,
    currency: normalizeNonEmptyString(record['currency']),
    regularAmount: normalizeRegularAmount(regularValue),
    cut: normalizeNumberOrNull(record['cut'])
  };
}

async function convertPricingSnapshotToChf(
  fetchImpl: typeof fetch,
  params: {
    historyLow: unknown;
    deals: unknown[];
    bestPrice: BestSteamPrice | null;
  },
  nowMs: number
): Promise<{ historyLow: unknown; deals: unknown[]; bestPrice: BestSteamPrice | null }> {
  const rateMemo = new Map<string, number>();
  const historyLow = await convertHistoryLowToChf(fetchImpl, params.historyLow, nowMs, rateMemo);
  const deals = await Promise.all(
    params.deals.map((deal) => convertDealToChf(fetchImpl, deal, nowMs, rateMemo))
  );
  const bestPrice = await convertBestPriceToChf(fetchImpl, params.bestPrice, nowMs, rateMemo);
  return { historyLow, deals, bestPrice };
}

async function convertHistoryLowToChf(
  fetchImpl: typeof fetch,
  value: unknown,
  nowMs: number,
  rateMemo: Map<string, number>
): Promise<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, lowValue] of Object.entries(source)) {
    output[key] = await convertMoneyRecordToChf(fetchImpl, lowValue, nowMs, rateMemo);
  }
  return output;
}

async function convertDealToChf(
  fetchImpl: typeof fetch,
  value: unknown,
  nowMs: number,
  rateMemo: Map<string, number>
): Promise<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const source = value as Record<string, unknown>;
  return {
    ...source,
    price: await convertMoneyRecordToChf(fetchImpl, source['price'], nowMs, rateMemo),
    regular: await convertMoneyRecordToChf(fetchImpl, source['regular'], nowMs, rateMemo),
    storeLow: await convertMoneyRecordToChf(fetchImpl, source['storeLow'], nowMs, rateMemo)
  };
}

async function convertBestPriceToChf(
  fetchImpl: typeof fetch,
  value: BestSteamPrice | null,
  nowMs: number,
  rateMemo: Map<string, number>
): Promise<BestSteamPrice | null> {
  if (!value) {
    return null;
  }

  const amount = await convertAmountToChf(fetchImpl, value.amount, value.currency, nowMs, rateMemo);
  const regularAmount =
    value.regularAmount === null
      ? null
      : await convertAmountToChf(fetchImpl, value.regularAmount, value.currency, nowMs, rateMemo);

  return {
    ...value,
    amount,
    regularAmount,
    currency: CHF_CURRENCY_CODE
  };
}

async function convertMoneyRecordToChf(
  fetchImpl: typeof fetch,
  value: unknown,
  nowMs: number,
  rateMemo: Map<string, number>
): Promise<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const source = value as Record<string, unknown>;
  const amount = normalizeNumberOrNull(source['amount']);
  const currency = normalizeNonEmptyString(source['currency']);
  if (amount === null || currency === null) {
    return value;
  }

  const convertedAmount = await convertAmountToChf(fetchImpl, amount, currency, nowMs, rateMemo);
  return {
    ...source,
    amount: convertedAmount,
    amountInt: Math.round(convertedAmount * 100),
    currency: CHF_CURRENCY_CODE
  };
}

async function convertAmountToChf(
  fetchImpl: typeof fetch,
  amount: number,
  sourceCurrency: string | null,
  nowMs: number,
  rateMemo: Map<string, number>
): Promise<number> {
  if (sourceCurrency === null) {
    return round2(amount);
  }

  const normalizedSource = sourceCurrency.toUpperCase();
  if (normalizedSource === CHF_CURRENCY_CODE) {
    return round2(amount);
  }

  const cachedRate = rateMemo.get(normalizedSource);
  const rate = cachedRate ?? (await getExchangeRateToChf(fetchImpl, normalizedSource, nowMs));
  rateMemo.set(normalizedSource, rate);
  return round2(amount * rate);
}

async function getExchangeRateToChf(
  fetchImpl: typeof fetch,
  sourceCurrency: string,
  nowMs: number
): Promise<number> {
  const dayKey = toUtcDayKey(nowMs);
  const cacheKey = `${sourceCurrency}->${CHF_CURRENCY_CODE}`;
  const cached = exchangeRateDailyCache.get(cacheKey);
  if (cached && cached.dayKey === dayKey) {
    return cached.rateToChf;
  }

  const url = new URL(
    `latest/${sourceCurrency}`,
    ensureTrailingSlash(config.exchangeRateApiBaseUrl)
  );
  const response = await fetchWithTimeout(
    fetchImpl,
    url.toString(),
    config.exchangeRateApiTimeoutMs
  );
  if (!response.ok) {
    throw new Error(`Exchange rate request failed with status ${String(response.status)}`);
  }

  const payload: unknown = await response.json();
  const rates = extractConversionRates(payload);
  const rate = normalizeNumberOrNull(rates?.[CHF_CURRENCY_CODE]);
  if (rate === null || rate <= 0) {
    throw new Error(`Missing valid ${CHF_CURRENCY_CODE} conversion rate for ${sourceCurrency}`);
  }

  exchangeRateDailyCache.set(cacheKey, {
    dayKey,
    rateToChf: rate
  });
  return rate;
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

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function extractConversionRates(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const rates = payload['conversion_rates'];
  if (rates && typeof rates === 'object' && !Array.isArray(rates)) {
    return rates as Record<string, unknown>;
  }

  const fallbackRates = payload['rates'];
  if (fallbackRates && typeof fallbackRates === 'object' && !Array.isArray(fallbackRates)) {
    return fallbackRates as Record<string, unknown>;
  }

  return null;
}

function toUtcDayKey(nowMs: number): string {
  const now = new Date(nowMs);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeRegularAmount(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const amount = normalizeNumberOrNull(record['amount']);
  if (amount !== null) {
    return amount;
  }

  const amountInt = normalizeNumberOrNull(record['amountInt']);
  if (amountInt === null) {
    return null;
  }

  return Math.round((amountInt / 100) * 100) / 100;
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

function serializeBestSteamPrice(value: BestSteamPrice): Record<string, unknown> {
  return {
    amount: value.amount,
    currency: value.currency,
    regularAmount: value.regularAmount,
    cut: value.cut,
    shopId: value.shopId,
    shopName: value.shopName,
    url: value.url,
    expiry: value.expiry,
    platforms: value.platforms
  };
}

async function persistItadSnapshot(
  pool: Pool,
  params: {
    igdbGameId: string;
    platformIgdbId: number;
    payload: Record<string, unknown>;
    country: string;
    itadGameId: string | null;
    bestPrice: BestSteamPrice | null;
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const nextPayload: Record<string, unknown> = {
    ...params.payload,
    itadGameId: params.itadGameId,
    itadPriceCountry: params.country,
    itadPriceFetchedAt: fetchedAt,
    itadPriceShopId: config.itadSteamShopId,
    itadPriceShopName: 'Steam',
    itadBestPriceAmount: params.bestPrice?.amount ?? null,
    itadBestPriceCurrency: params.bestPrice?.currency ?? null,
    itadBestPriceRegularAmount: params.bestPrice?.regularAmount ?? null,
    itadBestPriceCut: params.bestPrice?.cut ?? null,
    itadBestPriceUrl: params.bestPrice?.url ?? null,
    itadBestPriceExpiry: params.bestPrice?.expiry ?? null
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

async function postItadJson(fetchImpl: typeof fetch, url: URL, body: unknown): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`ITAD request failed with status ${String(response.status)}`);
  }

  return response.json();
}

function extractFirstItadGameId(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return ITAD_GAME_ID_PATTERN.test(normalized) ? normalized : null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = extractFirstItadGameId(entry);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const entry of Object.values(record)) {
    const candidate = extractFirstItadGameId(entry);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export const __itadPriceTestables = {
  extractFirstItadGameId,
  isWindowsDeal,
  isSteamShopDeal,
  normalizeCountryCode,
  normalizePositiveInteger,
  normalizeBooleanQuery,
  STEAM_APP_URL_PATTERN,
  clearExchangeRateDailyCache: () => {
    exchangeRateDailyCache.clear();
  }
};
