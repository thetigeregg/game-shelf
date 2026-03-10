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

interface PsPricesMatchInfo {
  queryTitle: string;
  matchedTitle: string | null;
  score: number | null;
  confidence: 'high' | 'low' | 'none';
}

interface PsPricesCandidate extends PsPricesSnapshot {
  score: number;
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

const PSPRICES_PLATFORM_BY_IGDB_ID = new Map<number, string>([
  [48, 'PS4'],
  [167, 'PS5'],
  [130, 'Switch'],
  [508, 'Switch2']
]);
const PSPRICES_TITLE_MATCH_MIN_SCORE = 70;
const PSPRICES_TITLE_MATCH_MIN_GAP = 8;

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
      const titleOverride = normalizeNonEmptyString(query['title']);
      const includeCandidates = normalizeBooleanQuery(query['includeCandidates']);

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
          bestPrice: null,
          match: null,
          ...(includeCandidates ? { candidates: [] } : {})
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
          bestPrice: cachedSnapshot,
          match: null,
          ...(includeCandidates ? { candidates: [] } : {})
        };
        reply.code(200).send(cachedPayload);
        return;
      }

      try {
        const pspricesLookup = await fetchPsPricesSnapshot(fetchImpl, {
          title,
          platform: pspricesPlatform,
          regionPath: config.pspricesRegionPath,
          show: config.pspricesShow
        });
        const pspricesSnapshot = pspricesLookup.snapshot;

        await persistPsPricesSnapshot(pool, {
          igdbGameId,
          platformIgdbId,
          payload,
          regionPath: config.pspricesRegionPath,
          show: config.pspricesShow,
          platform: pspricesPlatform,
          bestPrice: pspricesSnapshot,
          match: pspricesLookup.match
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
          bestPrice: pspricesSnapshot,
          match: pspricesLookup.match,
          ...(includeCandidates ? { candidates: pspricesLookup.candidates } : {})
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
  const candidatesRaw: unknown[] = Array.isArray(payloadRecord['candidates'])
    ? (payloadRecord['candidates'] as unknown[])
    : [];
  const itemRaw = payloadRecord['item'];
  const fallbackItem =
    itemRaw && typeof itemRaw === 'object' && !Array.isArray(itemRaw) ? [itemRaw] : [];
  const candidates = [...candidatesRaw, ...fallbackItem]
    .map((entry) => normalizePsPricesCandidate(entry))
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

function normalizePsPricesCandidate(item: unknown): PsPricesSnapshot | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }
  const candidate = item as Record<string, unknown>;
  const title = normalizeNonEmptyString(candidate['title']);
  if (!title) {
    return null;
  }

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
  const expected = normalizeTitleForMatch(expectedTitle);
  const candidate = normalizeTitleForMatch(candidateTitle);
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
  }
): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const preserveExisting = params.bestPrice === null;
  const nextPayload: Record<string, unknown> = {
    ...params.payload,
    priceSource: preserveExisting ? (params.payload['priceSource'] ?? null) : 'psprices',
    priceFetchedAt: fetchedAt,
    priceAmount: preserveExisting
      ? (params.payload['priceAmount'] ?? null)
      : params.bestPrice.amount,
    priceCurrency: preserveExisting
      ? (params.payload['priceCurrency'] ?? null)
      : (params.bestPrice.currency ?? null),
    priceRegularAmount: preserveExisting
      ? (params.payload['priceRegularAmount'] ?? null)
      : (params.bestPrice.regularAmount ?? null),
    priceDiscountPercent: preserveExisting
      ? (params.payload['priceDiscountPercent'] ?? null)
      : (params.bestPrice.discountPercent ?? null),
    priceIsFree: preserveExisting
      ? (params.payload['priceIsFree'] ?? null)
      : (params.bestPrice.isFree ?? null),
    priceUrl: preserveExisting
      ? (params.payload['priceUrl'] ?? null)
      : (params.bestPrice.url ?? null),
    psPricesFetchedAt: fetchedAt,
    psPricesSource: 'psprices',
    psPricesRegionPath: params.regionPath,
    psPricesShow: params.show,
    psPricesPlatform: params.platform,
    psPricesTitle: preserveExisting
      ? (params.payload['psPricesTitle'] ?? null)
      : (params.bestPrice.title ?? null),
    psPricesPriceAmount: preserveExisting
      ? (params.payload['psPricesPriceAmount'] ?? null)
      : params.bestPrice.amount,
    psPricesPriceCurrency: preserveExisting
      ? (params.payload['psPricesPriceCurrency'] ?? null)
      : (params.bestPrice.currency ?? null),
    psPricesRegularPriceAmount: preserveExisting
      ? (params.payload['psPricesRegularPriceAmount'] ?? null)
      : (params.bestPrice.regularAmount ?? null),
    psPricesDiscountPercent: preserveExisting
      ? (params.payload['psPricesDiscountPercent'] ?? null)
      : (params.bestPrice.discountPercent ?? null),
    psPricesIsFree: preserveExisting
      ? (params.payload['psPricesIsFree'] ?? null)
      : (params.bestPrice.isFree ?? null),
    psPricesUrl: preserveExisting
      ? (params.payload['psPricesUrl'] ?? null)
      : (params.bestPrice.url ?? null),
    psPricesMatchQueryTitle: params.match.queryTitle,
    psPricesMatchTitle: params.match.matchedTitle,
    psPricesMatchScore: params.match.score,
    psPricesMatchConfidence: params.match.confidence
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
