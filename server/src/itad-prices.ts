import type { FastifyInstance } from 'fastify';
import rateLimit from 'fastify-rate-limit';
import type { Pool, QueryResultRow } from 'pg';
import { config } from './config.js';

interface ItadPricesRouteOptions {
  fetchImpl?: typeof fetch;
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
  historyLow: unknown;
  deals: unknown[];
}

interface ItadPriceRow {
  id: string;
  historyLow: unknown;
  deals: unknown[];
}

const WINDOWS_IGDB_PLATFORM_ID = 6;
const WINDOWS_ITAD_PLATFORM_ID = 1;
const ITAD_GAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEAM_APP_URL_PATTERN = /store\.steampowered\.com\/app\/(\d+)/i;

export async function registerItadPricesRoute(
  app: FastifyInstance,
  pool: Pool,
  options: ItadPricesRouteOptions = {}
): Promise<void> {
  if (!app.hasDecorator('rateLimit')) {
    await app.register(rateLimit, { global: false });
  }

  const fetchImpl = options.fetchImpl ?? fetch;

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
      const shops = normalizeShopIdList(query['shops']);
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

      if (query['shops'] !== undefined && shops === null) {
        reply
          .code(400)
          .send({ error: 'shops must be a comma-separated list of positive integers.' });
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
            historyLow: null,
            deals: []
          };
          reply.code(200).send(unmatched);
          return;
        }

        const prices = await fetchItadPrices(fetchImpl, [itadGameId], {
          country,
          shops,
          dealsOnly,
          vouchers
        });
        const priceRow = prices.find((item) => item.id === itadGameId) ?? null;
        const deals = (priceRow?.deals ?? []).filter(isWindowsDeal);

        const okPayload: ItadRouteResponse = {
          status: 'ok',
          igdbGameId,
          platformIgdbId,
          country,
          steamAppId,
          itadGameId,
          matchStrategy,
          historyLow: priceRow?.historyLow ?? null,
          deals
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

function normalizeShopIdList(value: unknown): number[] | null {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (normalized.length === 0) {
    return [];
  }

  const parsed = normalized.map((item) => normalizePositiveInteger(item));
  if (parsed.some((item) => item === null)) {
    return null;
  }

  return [...new Set(parsed as number[])];
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
    shops: number[];
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

  if (options.shops.length > 0) {
    url.searchParams.set('shops', options.shops.join(','));
  }

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
  normalizeShopIdList,
  normalizeCountryCode,
  normalizePositiveInteger,
  normalizeBooleanQuery,
  STEAM_APP_URL_PATTERN
};
