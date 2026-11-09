// Client for the two Nintendo eShop APIs the Nintendo Europe website uses. Both are unofficial,
// undocumented and keyless:
// - Search (searching.nintendo-europe.com): a Solr index of the European store's games. It gives
//   each game's nsuid (eShop product ID) and the platforms it plays on, but its prices are those of
//   the index's own country, so they aren't used.
// - Prices (api.ec.nintendo.com/v1/price): the exact current price of up to 50 nsuids in one
//   country's eShop, with any sale price and when the sale ends.

import { config } from './config.js';
import { createProviderLimiter, type ProviderLimiter } from './provider-rate-limit.js';
import { round2 } from './utils/round.js';

/**
 * The search index is English: game titles in the library come from IGDB, which uses English
 * titles. European stores share nsuids, so the English index's nsuids price in any of them.
 */
const SEARCH_INDEX_LANGUAGE = 'en';
const SEARCH_RESULT_FIELDS = [
  'title',
  'nsuid_txt',
  'playable_on_txt',
  'image_url_sq_s',
  'eshop_removed_b',
];
/** The price API's limit per request. */
const MAX_PRICE_IDS_PER_REQUEST = 50;
const NSUID_PATTERN = /^70\d{12}$/;
/** The nsuid of a game itself; 7005… are upgrade packs and other add-ons, 7007… bundles. */
const GAME_NSUID_PREFIX = '7001';
/** Price states with a price everyone can pay now (a pre-order is paid now too). */
const PRICED_SALES_STATUSES = new Set(['onsale', 'preorder']);

export interface NintendoEshopLocale {
  /** ISO country code, e.g. "CH". */
  country: string;
  /** ISO language code, e.g. "de". */
  language: string;
}

export interface NintendoEshopRequestOptions {
  locale?: NintendoEshopLocale;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  searchBaseUrl?: string;
  priceApiBaseUrl?: string;
  limiter?: ProviderLimiter;
}

/** A game from search results. */
export interface NintendoEshopSearchGame {
  /** The game's own nsuid (not an upgrade pack's or bundle's). */
  nsuid: string;
  title: string;
  /** Platform codes the game plays on: HAC for Switch, BEE for Switch 2. */
  platformCodes: string[];
  imageUrl: string | null;
}

/** An nsuid's current price in one country's eShop. */
export interface NintendoEshopPrice {
  nsuid: string;
  amount: number;
  regularAmount: number;
  currency: string | null;
  discountPercent: number;
  isFree: boolean;
  /** When a discount ends (ISO time), if the game is discounted. */
  saleEndsAt: string | null;
}

let defaultLimiter: ProviderLimiter | null = null;

function resolveLimiter(options: NintendoEshopRequestOptions): ProviderLimiter {
  if (options.limiter) {
    return options.limiter;
  }
  defaultLimiter ??= createProviderLimiter(
    'nintendo_eshop',
    config.rateLimit.outbound.nintendo_eshop
  );
  return defaultLimiter;
}

export function resolveNintendoEshopLocale(): NintendoEshopLocale {
  return { country: config.nintendoEshopCountry, language: config.nintendoEshopLanguage };
}

/** The eShop link for an nsuid, which redirects to the game's page on the country's website. */
export function buildNintendoEshopGameUrl(
  nsuid: string,
  locale: NintendoEshopLocale = resolveNintendoEshopLocale()
): string {
  return `https://ec.nintendo.com/${locale.country.toUpperCase()}/${locale.language.toLowerCase()}/titles/${encodeURIComponent(nsuid)}`;
}

/**
 * The nsuid in `value`: an nsuid, an eShop link (https://ec.nintendo.com/CH/de/titles/<nsuid>) or a
 * Nintendo website game page reached through one (its URL carries `?nsuid=<nsuid>`).
 */
export function parseNintendoEshopNsuid(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return parseNintendoEshopNsuid(String(value));
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (NSUID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'nintendo.com' && !hostname.endsWith('.nintendo.com')) {
    return null;
  }
  const fromQuery = url.searchParams.get('nsuid')?.trim() ?? '';
  if (NSUID_PATTERN.test(fromQuery)) {
    return fromQuery;
  }
  const fromPath = url.pathname.match(/\/titles\/(\d+)(?:\/|$)/)?.[1] ?? '';
  return NSUID_PATTERN.test(fromPath) ? fromPath : null;
}

/** Searches the store's games playable on `platformCode` (HAC or BEE) by title. */
export async function searchNintendoEshopGames(
  term: string,
  platformCode: string,
  options: NintendoEshopRequestOptions & { rows?: number } = {}
): Promise<NintendoEshopSearchGame[]> {
  const docs = await requestSearch(
    {
      // Lowercase so title words such as "and" or "not" aren't read as query operators.
      q: escapeSolrTerm(term.toLowerCase()),
      fq: `type:GAME AND playable_on_txt:${escapeSolrTerm(platformCode)}`,
      rows: String(options.rows ?? 30),
    },
    options
  );
  return docs
    .map((doc) => normalizeSearchGame(doc))
    .filter((game): game is NintendoEshopSearchGame => game !== null);
}

/** The game an nsuid belongs to, or null when the search index doesn't list it. */
export async function fetchNintendoEshopGameByNsuid(
  nsuid: string,
  options: NintendoEshopRequestOptions = {}
): Promise<NintendoEshopSearchGame | null> {
  const docs = await requestSearch(
    { q: '*', fq: `type:GAME AND nsuid_txt:${escapeSolrTerm(nsuid)}`, rows: '1' },
    options
  );
  return docs.map((doc) => normalizeSearchGame(doc)).find((game) => game !== null) ?? null;
}

/**
 * Current prices of `nsuids` in the locale's country. An nsuid missing from the result isn't for
 * sale there (not sold in that country, not released yet, or delisted).
 */
export async function fetchNintendoEshopPrices(
  nsuids: readonly string[],
  options: NintendoEshopRequestOptions = {}
): Promise<Map<string, NintendoEshopPrice>> {
  const locale = options.locale ?? resolveNintendoEshopLocale();
  const unique = [...new Set(nsuids.filter((nsuid) => NSUID_PATTERN.test(nsuid)))];
  const prices = new Map<string, NintendoEshopPrice>();
  for (let start = 0; start < unique.length; start += MAX_PRICE_IDS_PER_REQUEST) {
    const batch = unique.slice(start, start + MAX_PRICE_IDS_PER_REQUEST);
    const endpoint = new URL(
      '/v1/price',
      options.priceApiBaseUrl ?? config.nintendoEshopPriceApiBaseUrl
    );
    endpoint.searchParams.set('country', locale.country.toUpperCase());
    endpoint.searchParams.set('lang', locale.language.toLowerCase());
    endpoint.searchParams.set('ids', batch.join(','));
    const body = asRecord(await requestJson(endpoint, 'price', options));
    // A reply without a price list is a failure, not "nothing for sale": treating it as a miss
    // would clear prices.
    if (!body || !Array.isArray(body['prices'])) {
      throw new Error('Nintendo eShop price request returned no price list');
    }
    for (const entry of body['prices'] as unknown[]) {
      const price = normalizePrice(entry);
      if (price) {
        prices.set(price.nsuid, price);
      }
    }
  }
  return prices;
}

/** Escapes Solr query syntax characters so a title is searched as plain text. */
export function escapeSolrTerm(value: string): string {
  return value.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
}

async function requestSearch(
  params: Record<string, string>,
  options: NintendoEshopRequestOptions
): Promise<unknown[]> {
  const endpoint = new URL(
    `/${SEARCH_INDEX_LANGUAGE}/select`,
    options.searchBaseUrl ?? config.nintendoEshopSearchBaseUrl
  );
  for (const [key, value] of Object.entries(params)) {
    endpoint.searchParams.set(key, value);
  }
  endpoint.searchParams.set('fl', SEARCH_RESULT_FIELDS.join(','));
  endpoint.searchParams.set('wt', 'json');
  const body = asRecord(await requestJson(endpoint, 'search', options));
  const docs = asRecord(body?.['response'])?.['docs'];
  if (!Array.isArray(docs)) {
    throw new Error('Nintendo eShop search returned no results list');
  }
  return docs as unknown[];
}

async function requestJson(
  endpoint: URL,
  operation: 'search' | 'price',
  options: NintendoEshopRequestOptions
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? config.nintendoEshopApiTimeoutMs;
  const limiter = resolveLimiter(options);
  const lease = await limiter.acquire();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 429) {
      limiter.consumeRateLimitHeaders(response.headers, 'upstream_429');
    }
    if (!response.ok) {
      throw new Error(
        `Nintendo eShop ${operation} request failed with status ${String(response.status)}`
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error(`Nintendo eShop ${operation} request returned a non-JSON reply`);
    }
  } finally {
    clearTimeout(timeoutId);
    lease.release();
  }
}

function normalizeSearchGame(value: unknown): NintendoEshopSearchGame | null {
  const doc = asRecord(value);
  if (!doc || doc['eshop_removed_b'] === true) {
    return null;
  }
  const title = normalizeNonEmptyString(doc['title']);
  const nsuid = readStringList(doc['nsuid_txt']).find(
    (candidate) => candidate.startsWith(GAME_NSUID_PREFIX) && NSUID_PATTERN.test(candidate)
  );
  if (!title || !nsuid) {
    return null; // Not sold digitally: nothing to price.
  }
  return {
    nsuid,
    title,
    platformCodes: readStringList(doc['playable_on_txt']),
    imageUrl: normalizeNonEmptyString(doc['image_url_sq_s']),
  };
}

function normalizePrice(value: unknown): NintendoEshopPrice | null {
  const entry = asRecord(value);
  const nsuid = entry ? normalizeNsuidValue(entry['title_id']) : null;
  if (!entry || !nsuid || !PRICED_SALES_STATUSES.has(String(entry['sales_status']))) {
    return null;
  }
  const regular = asRecord(entry['regular_price']);
  const regularAmount = parseAmount(regular?.['raw_value']);
  if (regularAmount === null) {
    return null;
  }
  const discount = asRecord(entry['discount_price']);
  const discountAmount = parseAmount(discount?.['raw_value']);
  const isDiscounted = discountAmount !== null && discountAmount < regularAmount;
  const amount = isDiscounted ? discountAmount : regularAmount;
  return {
    nsuid,
    amount,
    regularAmount,
    currency:
      normalizeNonEmptyString(regular?.['currency']) ??
      normalizeNonEmptyString(discount?.['currency']),
    discountPercent:
      isDiscounted && regularAmount > 0 ? Math.round((1 - amount / regularAmount) * 100) : 0,
    isFree: amount === 0,
    saleEndsAt: isDiscounted ? normalizeIsoTime(discount?.['end_datetime']) : null,
  };
}

function normalizeNsuidValue(value: unknown): string | null {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && NSUID_PATTERN.test(text.trim()) ? text.trim() : null;
}

function parseAmount(value: unknown): number | null {
  const text = typeof value === 'number' ? String(value) : normalizeNonEmptyString(value);
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) {
    return null;
  }
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

function normalizeIsoTime(value: unknown): string | null {
  const text = normalizeNonEmptyString(value);
  const parsedMs = text ? Date.parse(text) : Number.NaN;
  return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
