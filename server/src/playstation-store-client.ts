// Client for the PlayStation Store's web GraphQL API, the API store.playstation.com itself uses.
// It is unofficial and undocumented. It only runs queries Sony has registered ("persisted queries"),
// identified by the SHA-256 hash of the query text, so requests send a hash instead of a query.
// The hashes below were captured from the store website; if Sony changes those queries, the old
// hashes stop working and requests fail with PlayStationStoreQueryRejectedError until they're
// updated (capture them from a store page's network requests).

import { config } from './config.js';
import { createProviderLimiter, type ProviderLimiter } from './provider-rate-limit.js';
import { round2 } from './utils/round.js';

/** Search by title (`getSearchResults` on store.playstation.com/<locale>/search/<term>). */
export const PLAYSTATION_STORE_SEARCH_QUERY_HASH =
  '4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa';
/** One product's purchase prices (`productRetrieveForCtasWithPrice` on its product page). */
export const PLAYSTATION_STORE_PRODUCT_PRICE_QUERY_HASH =
  '911a43f47dbbf7b2f3d513d6237dedfd679e57af3f34787667a22ecad6a249cd';

const SEARCH_PAGE_SIZE = 24;
const PRODUCT_ID_PATTERN = /^[A-Z]{2}\d{4}-[A-Z]{4}\d{5}_\d{2}-[A-Z0-9]{16}$/;

export interface PlayStationStoreLocale {
  /** ISO country code, e.g. "CH". */
  country: string;
  /** ISO language code, e.g. "de". */
  language: string;
}

export interface PlayStationStoreRequestOptions {
  locale?: PlayStationStoreLocale;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
  limiter?: ProviderLimiter;
}

/** A product from search results. Prices are the store's display strings, parsed. */
export interface PlayStationStoreSearchProduct {
  productId: string;
  name: string;
  /** e.g. ["PS5"] or ["PS4", "PS5"] for a cross-buy product. */
  platforms: string[];
  /** e.g. FULL_GAME, PREMIUM_EDITION, GAME_BUNDLE, ADD_ON_PACK, DEMO. */
  classification: string | null;
  amount: number | null;
  regularAmount: number | null;
  currency: string | null;
  discountPercent: number | null;
  isFree: boolean;
  imageUrl: string | null;
}

/** A product's exact price, from its purchase options. */
export interface PlayStationStoreProductPrice {
  productId: string;
  name: string | null;
  amount: number;
  regularAmount: number;
  currency: string | null;
  discountPercent: number | null;
  isFree: boolean;
  /** When a discount ends (ISO time), if it does. */
  saleEndsAt: string | null;
}

/** The API refused a query hash: Sony changed the query and the hash needs updating. */
export class PlayStationStoreQueryRejectedError extends Error {
  constructor(operationName: string, message: string) {
    super(`PlayStation Store rejected the ${operationName} query: ${message}`);
    this.name = 'PlayStationStoreQueryRejectedError';
  }
}

let defaultLimiter: ProviderLimiter | null = null;

function resolveLimiter(options: PlayStationStoreRequestOptions): ProviderLimiter {
  if (options.limiter) {
    return options.limiter;
  }
  defaultLimiter ??= createProviderLimiter(
    'playstation_store',
    config.rateLimit.outbound.playstation_store
  );
  return defaultLimiter;
}

export function resolvePlayStationStoreLocale(): PlayStationStoreLocale {
  return { country: config.playstationStoreCountry, language: config.playstationStoreLanguage };
}

export function buildPlayStationStoreProductUrl(
  productId: string,
  locale: PlayStationStoreLocale = resolvePlayStationStoreLocale()
): string {
  return `https://store.playstation.com/${locale.language}-${locale.country.toLowerCase()}/product/${encodeURIComponent(productId)}`;
}

/**
 * The product ID in `value`, which is either an ID or a store product URL
 * (https://store.playstation.com/de-ch/product/EP9000-PPSA21567_00-0000000000000000).
 */
export function parsePlayStationStoreProductId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (PRODUCT_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'store.playstation.com') {
    return null;
  }
  const match = url.pathname.match(/\/product\/([^/?#]+)/);
  const candidate = match ? decodeURIComponent(match[1]) : null;
  return candidate && PRODUCT_ID_PATTERN.test(candidate) ? candidate : null;
}

/** Searches the store by title. */
export async function searchPlayStationStoreProducts(
  term: string,
  options: PlayStationStoreRequestOptions = {}
): Promise<PlayStationStoreSearchProduct[]> {
  const locale = options.locale ?? resolvePlayStationStoreLocale();
  const data = await requestPersistedQuery(
    'getSearchResults',
    PLAYSTATION_STORE_SEARCH_QUERY_HASH,
    {
      countryCode: locale.country,
      languageCode: locale.language,
      nextCursor: '',
      pageOffset: 0,
      pageSize: SEARCH_PAGE_SIZE,
      searchTerm: term,
    },
    locale,
    options
  );

  const search = asRecord(asRecord(data)?.['universalSearch']);
  const results = Array.isArray(search?.['results']) ? (search['results'] as unknown[]) : [];
  return results
    .map((entry) => normalizeSearchProduct(entry))
    .filter((entry): entry is PlayStationStoreSearchProduct => entry !== null);
}

/**
 * A product's current price, or null when the store doesn't sell it (any more) in this locale or
 * only has a subscription price for it.
 */
export async function fetchPlayStationStoreProductPrice(
  productId: string,
  options: PlayStationStoreRequestOptions = {}
): Promise<PlayStationStoreProductPrice | null> {
  const locale = options.locale ?? resolvePlayStationStoreLocale();
  let data: unknown;
  try {
    data = await requestPersistedQuery(
      'productRetrieveForCtasWithPrice',
      PLAYSTATION_STORE_PRODUCT_PRICE_QUERY_HASH,
      { productId },
      locale,
      options
    );
  } catch (error) {
    if (error instanceof PlayStationStoreProductNotFoundError) {
      return null;
    }
    throw error;
  }

  const product = asRecord(asRecord(data)?.['productRetrieve']);
  if (!product) {
    return null;
  }
  const ctas = Array.isArray(product['webctas']) ? (product['webctas'] as unknown[]) : [];
  for (const cta of ctas) {
    const price = normalizeCtaPrice(asRecord(asRecord(cta)?.['price']));
    if (price) {
      return {
        productId,
        name: normalizeNonEmptyString(product['name']),
        ...price,
      };
    }
  }
  return null;
}

/** Parses a store display price such as "CHF 49.62", "49,62 €" or "CHF 1'299.00". */
export function parsePlayStationStoreDisplayPrice(value: unknown): number | null {
  const text = normalizeNonEmptyString(value);
  if (!text) {
    return null;
  }
  const numeric = text.match(/\d[\d'’.,\s  ]*/)?.[0].replace(/[\s  ]/g, '');
  if (!numeric) {
    return null;
  }
  // The last "." or "," followed by one or two digits is the decimal separator; any other
  // separators group thousands.
  const decimalMatch = numeric.match(/[.,](\d{1,2})$/);
  const integerPart = (decimalMatch ? numeric.slice(0, -decimalMatch[0].length) : numeric).replace(
    /[^\d]/g,
    ''
  );
  if (!integerPart) {
    return null;
  }
  const parsed = Number.parseFloat(`${integerPart}.${decimalMatch ? decimalMatch[1] : '0'}`);
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

/** The currency in a display price: a three-letter code ("CHF 49.62") or a symbol. */
export function parsePlayStationStoreDisplayCurrency(value: unknown): string | null {
  const text = normalizeNonEmptyString(value);
  if (!text) {
    return null;
  }
  const code = text.match(/\b([A-Z]{3})\b/)?.[1];
  if (code) {
    return code;
  }
  if (text.includes('€')) {
    return 'EUR';
  }
  if (text.includes('£')) {
    return 'GBP';
  }
  // "$" alone is ambiguous (USD, CAD, AUD, ...): left to the store's country.
  return null;
}

/** Parses a discount label such as "–29 %" or "-50%" into 29 or 50. */
export function parsePlayStationStoreDiscountPercent(value: unknown): number | null {
  const text = normalizeNonEmptyString(value);
  const match = text?.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? round2(parsed) : null;
}

class PlayStationStoreProductNotFoundError extends Error {}

async function requestPersistedQuery(
  operationName: string,
  hash: string,
  variables: Record<string, unknown>,
  locale: PlayStationStoreLocale,
  options: PlayStationStoreRequestOptions
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? config.playstationStoreApiTimeoutMs;
  const endpoint = new URL(
    '/api/graphql/v1/op',
    options.baseUrl ?? config.playstationStoreApiBaseUrl
  );
  endpoint.searchParams.set('operationName', operationName);
  endpoint.searchParams.set('variables', JSON.stringify(variables));
  endpoint.searchParams.set(
    'extensions',
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } })
  );

  const limiter = resolveLimiter(options);
  const lease = await limiter.acquire();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let response: Response;
  let body: unknown;
  try {
    response = await fetchImpl(endpoint.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        // Without a JSON content type the API's cross-site request protection rejects a GET.
        'Content-Type': 'application/json',
        'x-psn-store-locale-override': `${locale.language}-${locale.country}`,
      },
      signal: controller.signal,
    });
    if (response.status === 429) {
      limiter.consumeRateLimitHeaders(response.headers, 'upstream_429');
    }
    body = await response.json().catch(() => null);
  } finally {
    clearTimeout(timeoutId);
    lease.release();
  }

  const record = asRecord(body);
  const message = normalizeNonEmptyString(record?.['message']);
  if (message && /not whitelisted/i.test(message)) {
    throw new PlayStationStoreQueryRejectedError(operationName, message);
  }
  if (isProductNotFound(record)) {
    throw new PlayStationStoreProductNotFoundError();
  }
  if (!response.ok) {
    throw new Error(
      `PlayStation Store ${operationName} request failed with status ${String(response.status)}${message ? `: ${message}` : ''}`
    );
  }
  const errors = Array.isArray(record?.['errors']) ? (record['errors'] as unknown[]) : [];
  if (record?.['data'] === undefined || record['data'] === null) {
    const firstError = normalizeNonEmptyString(asRecord(errors[0])?.['message']);
    throw new Error(
      `PlayStation Store ${operationName} returned no data${firstError ? `: ${firstError}` : ''}`
    );
  }
  return record['data'];
}

function isProductNotFound(record: Record<string, unknown> | null): boolean {
  const errors = Array.isArray(record?.['errors']) ? (record['errors'] as unknown[]) : [];
  return errors.some((entry) => {
    const error = asRecord(asRecord(entry)?.['extensions'])?.['error'];
    return asRecord(error)?.['reason'] === 'data_not_found';
  });
}

function normalizeSearchProduct(value: unknown): PlayStationStoreSearchProduct | null {
  const record = asRecord(value);
  if (record?.['__typename'] !== 'Product') {
    return null;
  }
  const productId = normalizeNonEmptyString(record['id']);
  const name = normalizeNonEmptyString(record['name']);
  if (!productId || !name) {
    return null;
  }
  const price = asRecord(record['price']);
  const isFree = price?.['isFree'] === true;
  const basePrice = price?.['basePrice'];
  const discountedPrice = price?.['discountedPrice'];
  const amount = isFree ? 0 : parsePlayStationStoreDisplayPrice(discountedPrice);
  const regularAmount = isFree ? 0 : parsePlayStationStoreDisplayPrice(basePrice);
  const media = Array.isArray(record['media']) ? (record['media'] as unknown[]) : [];
  const master = media
    .map((entry) => asRecord(entry))
    .find((entry) => entry?.['role'] === 'MASTER');

  return {
    productId,
    name,
    platforms: Array.isArray(record['platforms'])
      ? (record['platforms'] as unknown[]).filter(
          (platform): platform is string => typeof platform === 'string'
        )
      : [],
    classification: normalizeNonEmptyString(record['storeDisplayClassification']),
    amount,
    regularAmount: regularAmount ?? amount,
    currency:
      parsePlayStationStoreDisplayCurrency(discountedPrice) ??
      parsePlayStationStoreDisplayCurrency(basePrice),
    discountPercent: isFree ? 0 : parsePlayStationStoreDiscountPercent(price?.['discountText']),
    isFree,
    imageUrl: normalizeNonEmptyString(master?.['url']),
  };
}

function normalizeCtaPrice(
  price: Record<string, unknown> | null
): Omit<PlayStationStoreProductPrice, 'productId' | 'name'> | null {
  if (!price || price['applicability'] !== 'APPLICABLE' || price['isTiedToSubscription'] === true) {
    return null;
  }
  const branding = Array.isArray(price['serviceBranding'])
    ? (price['serviceBranding'] as unknown[])
    : [];
  if (branding.some((entry) => entry !== 'NONE')) {
    return null; // A PS Plus (or other subscription) price, not what everyone pays.
  }
  const regularCents = normalizeInteger(price['basePriceValue']);
  const currentCents = normalizeInteger(price['discountedValue']);
  if (regularCents === null || currentCents === null) {
    return null;
  }
  const endTimeMs = normalizeInteger(price['endTime']);
  const isFree = price['isFree'] === true || currentCents === 0;
  return {
    amount: round2(currentCents / 100),
    regularAmount: round2(regularCents / 100),
    currency: normalizeNonEmptyString(price['currencyCode']),
    discountPercent:
      regularCents > 0 && currentCents < regularCents
        ? Math.round((1 - currentCents / regularCents) * 100)
        : 0,
    isFree,
    saleEndsAt:
      endTimeMs !== null && currentCents < regularCents ? new Date(endTimeMs).toISOString() : null,
  };
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
