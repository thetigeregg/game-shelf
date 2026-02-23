import { IGDB_TO_THEGAMESDB_PLATFORM_ID } from './platform-id-map.mjs';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const IGDB_RATE_LIMIT_MIN_COOLDOWN_SECONDS = 20;
const IGDB_RATE_LIMIT_DEFAULT_COOLDOWN_SECONDS = 15;
const IGDB_RATE_LIMIT_MAX_COOLDOWN_SECONDS = 60;
const MAX_BOX_ART_RESULTS = 30;
const IGDB_REQUEST_TIMEOUT_DEFAULT_MS = 15_000;
const THEGAMESDB_REQUEST_TIMEOUT_DEFAULT_MS = 15_000;
const THE_GAMES_DB_PREFERRED_COUNTRY_IDS = new Set([50]);
const THE_GAMES_DB_SECONDARY_COUNTRY_ID = 0;
const THE_GAMES_DB_PREFERRED_REGION_IDS = new Set([2]);
const THE_GAMES_DB_SECONDARY_REGION_IDS = new Set([1]);
const PLATFORM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const POPULARITY_TYPES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const IGDB_CATEGORY_REMAKE = 8;
const IGDB_CATEGORY_REMASTER = 9;

const tokenCache = {
  accessToken: null,
  expiresAt: 0
};

const rateLimitCache = new Map();
const RATE_LIMIT_CACHE_SWEEP_INTERVAL = 250;
const RATE_LIMIT_CACHE_MAX_SIZE = 5000;
let rateLimitSweepCounter = 0;
const igdbSearchVariantCache = {
  preferredVariantIndex: 0,
  disabledVariants: new Set()
};
const igdbPlatformCache = {
  items: null,
  expiresAt: 0
};
const igdbPopularityTypeCache = {
  items: null,
  expiresAt: 0
};
const igdbRateLimitState = {
  cooldownUntilMs: 0
};

export function resetCaches() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
  rateLimitCache.clear();
  igdbSearchVariantCache.preferredVariantIndex = 0;
  igdbSearchVariantCache.disabledVariants.clear();
  igdbPlatformCache.items = null;
  igdbPlatformCache.expiresAt = 0;
  igdbPopularityTypeCache.items = null;
  igdbPopularityTypeCache.expiresAt = 0;
  igdbRateLimitState.cooldownUntilMs = 0;
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}

function normalizeSearchQuery(url) {
  return (url.searchParams.get('q') ?? '').trim();
}

function normalizePlatformQuery(url) {
  return (url.searchParams.get('platform') ?? '').trim();
}

function normalizePlatformIgdbIdQuery(url) {
  const raw = (url.searchParams.get('platformIgdbId') ?? '').trim();

  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function normalizePopularityTypeIdQuery(url) {
  const raw = String(url.searchParams.get('popularityTypeId') ?? '').trim();

  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeLimitQuery(url, fallback) {
  const raw = String(url.searchParams.get('limit') ?? '').trim();

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 1), 100);
}

function normalizeOffsetQuery(url) {
  const raw = String(url.searchParams.get('offset') ?? '').trim();

  if (!raw) {
    return 0;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeGameIdFromPath(pathname) {
  const match = pathname.match(/^\/v1\/games\/(\d+)$/);
  return match ? match[1] : null;
}

function resolveTheGamesDbPlatformId(igdbPlatformId) {
  if (!Number.isInteger(igdbPlatformId) || igdbPlatformId <= 0) {
    return null;
  }

  const mapped = IGDB_TO_THEGAMESDB_PLATFORM_ID.get(igdbPlatformId);
  return Number.isInteger(mapped) && mapped > 0 ? mapped : null;
}

function getMappedIgdbPlatformIds() {
  return [...IGDB_TO_THEGAMESDB_PLATFORM_ID.keys()]
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((left, right) => left - right);
}

function isSensitiveUrl(urlString) {
  return urlString.startsWith('https://id.twitch.tv/oauth2/token');
}

function sanitizeUrlForLogs(urlInput) {
  try {
    const parsed = new URL(String(urlInput));
    const sensitiveKeys = ['client_secret', 'apikey', 'client_id'];

    sensitiveKeys.forEach((key) => {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, '***');
      }
    });

    return parsed.toString();
  } catch {
    return String(urlInput);
  }
}

function buildBodyPreview(body) {
  return typeof body === 'string' && body.length > 0 ? body : undefined;
}

function shouldLogHttp(env, requestUrl) {
  if (typeof env.DEBUG_HTTP_LOGS === 'string') {
    return env.DEBUG_HTTP_LOGS.toLowerCase() === 'true';
  }

  const hostname = requestUrl.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function createLoggedFetch(fetchImpl, debugHttpEnabled) {
  if (!debugHttpEnabled) {
    return fetchImpl;
  }

  return async (url, options = {}) => {
    const method =
      typeof options?.method === 'string' && options.method.length > 0 ? options.method : 'GET';
    const sanitizedUrl = sanitizeUrlForLogs(url);

    console.info('[http] request', {
      method,
      url: sanitizedUrl,
      body: buildBodyPreview(options?.body)
    });

    const response = await fetchImpl(url, options);
    let responsePreview;

    if (!isSensitiveUrl(String(url))) {
      try {
        responsePreview = await response.clone().text();
      } catch {
        responsePreview = undefined;
      }
    }

    console.info('[http] response', {
      method,
      url: sanitizedUrl,
      status: response.status,
      body: responsePreview
    });

    return response;
  };
}

function normalizeIgdbReferenceId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }

  if (typeof value === 'object' && value !== null) {
    const nestedId = value.id;

    if (typeof nestedId === 'number' && Number.isFinite(nestedId)) {
      return String(Math.trunc(nestedId));
    }
  }

  return null;
}

function normalizeIgdbRankScore(game) {
  const candidates = [
    game?.total_rating_count,
    game?.rating_count,
    game?.hypes,
    game?.aggregated_rating_count
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return Number.NEGATIVE_INFINITY;
}

function normalizeGameTypeLabel(gameType) {
  if (typeof gameType === 'string' && gameType.trim().length > 0) {
    return gameType.trim().toLowerCase();
  }

  if (gameType && typeof gameType === 'object') {
    const fromTypeField = typeof gameType.type === 'string' ? gameType.type.trim() : '';

    if (fromTypeField.length > 0) {
      return fromTypeField.toLowerCase();
    }
  }

  return null;
}

function normalizeGameTypeValue(gameType) {
  const normalizedLabel = normalizeGameTypeLabel(gameType);

  if (!normalizedLabel) {
    return null;
  }

  return (
    normalizedLabel
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .trim() || null
  );
}

function isRemakeOrRemaster(gameType, categoryFallback) {
  const normalizedType = normalizeGameTypeLabel(gameType);

  if (normalizedType === 'remake' || normalizedType === 'remaster') {
    return true;
  }

  // Backward-compatible fallback while game_type rollout is validated.
  const normalizedCategory = typeof categoryFallback === 'number' ? categoryFallback : Number.NaN;
  return (
    normalizedCategory === IGDB_CATEGORY_REMAKE || normalizedCategory === IGDB_CATEGORY_REMASTER
  );
}

function getOriginalGameId(game) {
  const parentGame = normalizeIgdbReferenceId(game?.parent_game);

  if (parentGame) {
    return parentGame;
  }

  return normalizeIgdbReferenceId(game?.version_parent);
}

function sortIgdbSearchResults(games) {
  if (!Array.isArray(games) || games.length <= 1) {
    return Array.isArray(games) ? games : [];
  }

  const indexed = games.map((game, index) => ({
    game,
    index,
    id: normalizeIgdbReferenceId(game?.id),
    rankScore: normalizeIgdbRankScore(game),
    originalId: getOriginalGameId(game),
    isRemakeOrRemaster: isRemakeOrRemaster(game?.game_type, game?.category)
  }));

  const idSet = new Set(indexed.map((entry) => entry.id).filter(Boolean));

  indexed.sort((left, right) => {
    if (left.rankScore !== right.rankScore) {
      return right.rankScore - left.rankScore;
    }

    return left.index - right.index;
  });

  const byId = new Map(indexed.map((entry, index) => [entry.id, index]));

  indexed.forEach((entry) => {
    if (!entry.isRemakeOrRemaster || !entry.originalId || !idSet.has(entry.originalId)) {
      return;
    }

    let remakeIndex = byId.get(entry.id);
    let originalIndex = byId.get(entry.originalId);

    if (
      typeof remakeIndex !== 'number' ||
      typeof originalIndex !== 'number' ||
      remakeIndex > originalIndex
    ) {
      return;
    }

    const [remakeEntry] = indexed.splice(remakeIndex, 1);
    originalIndex = byId.get(entry.originalId);

    if (typeof originalIndex !== 'number') {
      return;
    }

    indexed.splice(originalIndex + 1, 0, remakeEntry);
    byId.clear();
    indexed.forEach((item, index) => {
      byId.set(item.id, index);
    });
  });

  return indexed.map((entry) => entry.game);
}

function isBoxArtSearchPath(pathname) {
  return pathname === '/v1/images/boxart/search';
}

function getLocalRateLimitRetryAfterSeconds(ipAddress, nowMs) {
  sweepLocalRateLimitCache(nowMs);
  const key = ipAddress || 'unknown';
  const entry = rateLimitCache.get(key);

  if (!entry || nowMs - entry.startedAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitCache.set(key, { startedAt: nowMs, count: 1 });
    return null;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterMs = Math.max(RATE_LIMIT_WINDOW_MS - (nowMs - entry.startedAt), 0);
    return Math.max(IGDB_RATE_LIMIT_MIN_COOLDOWN_SECONDS, Math.ceil(retryAfterMs / 1000));
  }

  entry.count += 1;
  return null;
}

function sweepLocalRateLimitCache(nowMs) {
  rateLimitSweepCounter += 1;
  const shouldSweepByInterval = rateLimitSweepCounter % RATE_LIMIT_CACHE_SWEEP_INTERVAL === 0;

  if (!shouldSweepByInterval && rateLimitCache.size <= RATE_LIMIT_CACHE_MAX_SIZE) {
    return;
  }

  for (const [key, entry] of rateLimitCache.entries()) {
    if (nowMs - entry.startedAt > RATE_LIMIT_WINDOW_MS) {
      rateLimitCache.delete(key);
    }
  }
}

function parseRetryAfterSeconds(value, nowMs) {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(String(value).trim(), 10);

  if (Number.isInteger(seconds) && seconds >= 0) {
    return Math.max(
      IGDB_RATE_LIMIT_MIN_COOLDOWN_SECONDS,
      Math.min(seconds, IGDB_RATE_LIMIT_MAX_COOLDOWN_SECONDS)
    );
  }

  const dateMs = Date.parse(String(value));

  if (Number.isNaN(dateMs)) {
    return null;
  }

  const deltaSeconds = Math.ceil(Math.max(dateMs - nowMs, 0) / 1000);
  return Math.max(
    IGDB_RATE_LIMIT_MIN_COOLDOWN_SECONDS,
    Math.min(deltaSeconds, IGDB_RATE_LIMIT_MAX_COOLDOWN_SECONDS)
  );
}

function resolveRetryAfterSecondsFromHeaders(headers, nowMs) {
  const parsed = parseRetryAfterSeconds(headers?.get('Retry-After') ?? null, nowMs);
  return (
    parsed ??
    Math.max(IGDB_RATE_LIMIT_MIN_COOLDOWN_SECONDS, IGDB_RATE_LIMIT_DEFAULT_COOLDOWN_SECONDS)
  );
}

function getUpstreamCooldownRemainingSeconds(nowMs) {
  if (igdbRateLimitState.cooldownUntilMs <= nowMs) {
    return 0;
  }

  const remainingMs = igdbRateLimitState.cooldownUntilMs - nowMs;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function setUpstreamCooldown(retryAfterSeconds, nowMs) {
  const clampedSeconds = Math.max(
    IGDB_RATE_LIMIT_MIN_COOLDOWN_SECONDS,
    Math.min(retryAfterSeconds, IGDB_RATE_LIMIT_MAX_COOLDOWN_SECONDS)
  );
  const nextCooldownUntilMs = nowMs + clampedSeconds * 1000;
  igdbRateLimitState.cooldownUntilMs = Math.max(
    igdbRateLimitState.cooldownUntilMs,
    nextCooldownUntilMs
  );
  return getUpstreamCooldownRemainingSeconds(nowMs);
}

class UpstreamRateLimitError extends Error {
  constructor(retryAfterSeconds) {
    super('IGDB upstream rate limit exceeded');
    this.name = 'UpstreamRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const __testables = {
  normalizePlatformIgdbIdQuery,
  normalizePopularityTypeIdQuery,
  normalizeLimitQuery,
  normalizeOffsetQuery,
  normalizeIgdbReferenceId,
  normalizeIgdbRankScore,
  normalizeGameTypeLabel,
  normalizeGameTypeValue,
  isRemakeOrRemaster,
  getOriginalGameId,
  sortIgdbSearchResults,
  resolveTheGamesDbPlatformId,
  sanitizeUrlForLogs,
  buildBodyPreview,
  parseRetryAfterSeconds,
  resolveRetryAfterSecondsFromHeaders,
  normalizeOptionalText,
  normalizeNumericValue,
  normalizeIgdbNamedCollection,
  normalizeIgdbReferenceIds,
  normalizeIgdbCompanyNames,
  getIgdbRequestTimeoutMs,
  getTheGamesDbRequestTimeoutMs,
  normalizeTheGamesDbUrl,
  foldToAsciiForSearch,
  buildQueryFallbacks,
  escapeQuery,
  getTitleSimilarityScore,
  findTheGamesDbBoxArtCandidates,
  getTheGamesDbRegionPreferenceScoreFromIds,
  getTheGamesDbRegionId,
  getTheGamesDbCountryId
};

function escapeQuery(query) {
  return String(query ?? '')
    .replace(/[;\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCoverUrl(imageId) {
  if (!imageId) {
    return null;
  }

  return `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
}

export function normalizeIgdbGame(game) {
  const platformOptions = Array.isArray(game.platforms)
    ? game.platforms
        .map((platform) => {
          const name = typeof platform?.name === 'string' ? platform.name.trim() : '';
          const id = Number.isFinite(platform?.id) ? Math.trunc(platform.id) : null;
          return {
            id: Number.isInteger(id) && id > 0 ? id : null,
            name
          };
        })
        .filter((platform) => platform.name.length > 0)
        .filter((platform, index, items) => {
          return (
            items.findIndex(
              (candidate) => candidate.id === platform.id && candidate.name === platform.name
            ) === index
          );
        })
    : [];
  const platforms = [...new Set(platformOptions.map((platform) => platform.name))];
  const releaseYear = Number.isFinite(game.first_release_date)
    ? new Date(game.first_release_date * 1000).getUTCFullYear()
    : null;
  const releaseDate = Number.isFinite(game.first_release_date)
    ? new Date(game.first_release_date * 1000).toISOString()
    : null;
  const developers = normalizeIgdbCompanyNames(game, 'developer');
  const publishers = normalizeIgdbCompanyNames(game, 'publisher');
  const collections = normalizeIgdbNamedCollection(game?.collections);
  const similarGameIgdbIds = normalizeIgdbReferenceIds(game?.similar_games);
  const franchises = normalizeIgdbNamedCollection(game?.franchises);
  const genres = normalizeIgdbNamedCollection(game?.genres);
  const storyline = normalizeOptionalText(game?.storyline);
  const summary = normalizeOptionalText(game?.summary);

  return {
    externalId: String(game.id ?? '').trim(),
    title:
      typeof game.name === 'string' && game.name.trim().length > 0
        ? game.name.trim()
        : 'Unknown title',
    coverUrl: buildCoverUrl(game.cover?.image_id ?? null),
    coverSource: game.cover?.image_id ? 'igdb' : 'none',
    storyline,
    summary,
    gameType: normalizeGameTypeValue(game.game_type),
    similarGameIgdbIds,
    collections,
    developers,
    publishers,
    franchises,
    genres,
    platforms,
    platformOptions,
    platform: platforms.length === 1 ? platforms[0] : null,
    platformIgdbId: platformOptions.length === 1 ? platformOptions[0].id : null,
    releaseDate,
    releaseYear
  };
}

function normalizeOptionalText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIgdbUnixDatetime(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const date = new Date(Math.trunc(value) * 1000);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? null : date.toISOString();
}

function normalizeNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeIgdbNamedCollection(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => (typeof value?.name === 'string' ? value.name.trim() : ''))
        .filter((value) => value.length > 0)
    )
  ];
}

function normalizeIgdbReferenceIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => normalizeIgdbReferenceId(value))
        .filter((value) => typeof value === 'string' && value.length > 0)
    )
  ];
}

function normalizeIgdbCompanyNames(game, roleKey) {
  if (!Array.isArray(game?.involved_companies)) {
    return [];
  }

  return [
    ...new Set(
      game.involved_companies
        .filter((company) => company?.[roleKey] === true)
        .map((company) =>
          typeof company?.company?.name === 'string' ? company.company.name.trim() : ''
        )
        .filter((name) => name.length > 0)
    )
  ];
}

function getTheGamesDbApiKey(env) {
  return typeof env.THEGAMESDB_API_KEY === 'string' && env.THEGAMESDB_API_KEY.trim().length > 0
    ? env.THEGAMESDB_API_KEY.trim()
    : null;
}

function getIgdbRequestTimeoutMs(env) {
  const raw = Number.parseInt(String(env.IGDB_REQUEST_TIMEOUT_MS ?? ''), 10);

  if (!Number.isInteger(raw) || raw < 1000) {
    return IGDB_REQUEST_TIMEOUT_DEFAULT_MS;
  }

  return Math.min(raw, 120_000);
}

function getTheGamesDbRequestTimeoutMs(env) {
  const raw = Number.parseInt(String(env.THEGAMESDB_REQUEST_TIMEOUT_MS ?? ''), 10);

  if (!Number.isInteger(raw) || raw < 1000) {
    return THEGAMESDB_REQUEST_TIMEOUT_DEFAULT_MS;
  }

  return Math.min(raw, 120_000);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeTheGamesDbUrl(filename, baseUrl) {
  if (typeof filename !== 'string' || filename.length === 0) {
    return null;
  }

  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return filename;
  }

  const normalizedBase = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : '';

  if (!normalizedBase) {
    return null;
  }

  const normalizedFilename = filename.startsWith('/') ? filename : `/${filename}`;
  return `${normalizedBase}${normalizedFilename}`;
}

function normalizeTitleForMatch(title) {
  return foldToAsciiForSearch(String(title ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTheGamesDbGameTitle(game) {
  return game?.game_title ?? game?.name ?? game?.title ?? '';
}

function getTheGamesDbGameId(game) {
  return String(game?.id ?? '').trim();
}

function normalizePlatformForMatch(platform) {
  return foldToAsciiForSearch(String(platform ?? ''))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function foldToAsciiForSearch(value) {
  const normalized = String(value ?? '').trim();

  if (normalized.length === 0) {
    return '';
  }

  try {
    return normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return normalized;
  }
}

function buildQueryFallbacks(query) {
  const primary = String(query ?? '').trim();
  const folded = foldToAsciiForSearch(primary);
  const unique = [];

  [primary, folded].forEach((candidate) => {
    if (!candidate || unique.includes(candidate)) {
      return;
    }

    unique.push(candidate);
  });

  return unique;
}

function getTheGamesDbPlatformText(game) {
  const candidates = [
    game?.platform,
    game?.platform_name,
    game?.platformName,
    game?.system,
    game?.system_name
  ];

  return candidates
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

function levenshteinDistance(left, right) {
  const leftLength = left.length;
  const rightLength = right.length;

  if (leftLength === 0) {
    return rightLength;
  }

  if (rightLength === 0) {
    return leftLength;
  }

  const matrix = Array.from({ length: leftLength + 1 }, () => Array(rightLength + 1).fill(0));

  for (let i = 0; i <= leftLength; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= rightLength; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= leftLength; i += 1) {
    for (let j = 1; j <= rightLength; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[leftLength][rightLength];
}

function getTitleSimilarityScore(expectedTitle, candidateTitle) {
  const expected = normalizeTitleForMatch(expectedTitle);
  const candidate = normalizeTitleForMatch(candidateTitle);

  if (!expected || !candidate) {
    return -1;
  }

  let score = 0;

  if (expected === candidate) {
    score += 100;
  }

  if (expected.includes(candidate) || candidate.includes(expected)) {
    score += 25;
  }

  const expectedTokens = expected.split(' ').filter(Boolean);
  const candidateTokens = candidate.split(' ').filter(Boolean);
  const expectedTokenSet = new Set(expectedTokens);
  const candidateTokenSet = new Set(candidateTokens);
  const intersectionCount = [...expectedTokenSet].filter((token) =>
    candidateTokenSet.has(token)
  ).length;
  const unionCount = new Set([...expectedTokenSet, ...candidateTokenSet]).size;

  if (unionCount > 0) {
    score += (intersectionCount / unionCount) * 40;
  }

  const distance = levenshteinDistance(expected, candidate);
  const maxLength = Math.max(expected.length, candidate.length);

  if (maxLength > 0) {
    score += (1 - distance / maxLength) * 30;
  }

  return score;
}

function findTheGamesDbBoxArtCandidates(payload, expectedTitle, preferredPlatform = null) {
  const root = payload?.data;
  const includeRoot = payload?.include;
  const normalizedPreferredPlatform = normalizePlatformForMatch(preferredPlatform);
  const normalizedExpectedTitle = normalizeTitleForMatch(expectedTitle);

  const games = Array.isArray(root?.games) ? root.games : [];

  if (games.length === 0) {
    return [];
  }

  const rankedGames = games
    .map((game) => {
      const gameTitle = getTheGamesDbGameTitle(game);
      const normalizedTitle = normalizeTitleForMatch(gameTitle);
      const regionId = getTheGamesDbRegionId(game);
      const countryId = getTheGamesDbCountryId(game);
      const regionPreferenceScore = getTheGamesDbRegionPreferenceScoreFromIds({
        regionId,
        countryId
      });

      return {
        gameId: getTheGamesDbGameId(game),
        score: getTitleSimilarityScore(expectedTitle, gameTitle),
        normalizedTitle,
        regionPreferenceScore,
        countryId,
        regionId,
        platformText: getTheGamesDbPlatformText(game)
      };
    })
    .filter((entry) => entry.gameId.length > 0 && Number.isFinite(entry.score))
    .sort((left, right) => {
      const byScore = right.score - left.score;

      if (byScore !== 0) {
        return byScore;
      }

      const sameNormalizedTitle =
        left.normalizedTitle.length > 0 && left.normalizedTitle === right.normalizedTitle;
      const matchesExpected =
        left.normalizedTitle.length > 0 && left.normalizedTitle === normalizedExpectedTitle;

      if (sameNormalizedTitle && matchesExpected) {
        const byRegionPreference = right.regionPreferenceScore - left.regionPreferenceScore;

        if (byRegionPreference !== 0) {
          return byRegionPreference;
        }
      }

      return 0;
    });

  if (rankedGames.length === 0) {
    return [];
  }

  const boxartRoot = includeRoot?.boxart;
  const baseUrl =
    boxartRoot?.base_url?.large ||
    boxartRoot?.base_url?.medium ||
    boxartRoot?.base_url?.original ||
    null;

  if (!baseUrl) {
    return [];
  }

  const dataByGame = boxartRoot?.data ?? {};
  const scoredByUrl = new Map();

  rankedGames.forEach((gameEntry, gameIndex) => {
    const candidates = Array.isArray(dataByGame[gameEntry.gameId])
      ? dataByGame[gameEntry.gameId]
      : [];

    candidates.forEach((candidate) => {
      const imageType = typeof candidate?.type === 'string' ? candidate.type.toLowerCase() : '';
      const imageSide = typeof candidate?.side === 'string' ? candidate.side.toLowerCase() : '';
      const filename = candidate?.filename ?? candidate?.thumb ?? null;
      const url = normalizeTheGamesDbUrl(filename, baseUrl);

      if (!url || !imageType.includes('boxart')) {
        return;
      }

      // Keep title similarity as the dominant ranking signal.
      // Region/platform/image-side preferences are secondary tie-breakers.
      const titleRankScore = Math.max(0, rankedGames.length - gameIndex);
      const majorScore = gameEntry.score * 100000 + titleRankScore * 1000;
      let minorScore = 0;

      if (imageSide === 'front') {
        minorScore += 10;
      }

      minorScore += getTheGamesDbRegionPreferenceScore(candidate, gameEntry);

      if (normalizedPreferredPlatform.length > 0) {
        const normalizedGamePlatform = normalizePlatformForMatch(gameEntry.platformText);

        if (normalizedGamePlatform.includes(normalizedPreferredPlatform)) {
          minorScore += 20;
        }
      }

      const score = majorScore + minorScore;

      const existingScore = scoredByUrl.get(url);

      if (typeof existingScore !== 'number' || score > existingScore) {
        scoredByUrl.set(url, score);
      }
    });
  });

  return [...scoredByUrl.entries()]
    .sort((left, right) => right[1] - left[1])
    .map((entry) => entry[0])
    .slice(0, MAX_BOX_ART_RESULTS);
}

function getTheGamesDbRegionPreferenceScore(candidate, gameEntry) {
  void candidate;
  return getTheGamesDbRegionPreferenceScoreFromIds(gameEntry);
}

function getTheGamesDbRegionPreferenceScoreFromIds(gameEntry) {
  const regionId =
    Number.isInteger(gameEntry?.regionId) && gameEntry.regionId > 0 ? gameEntry.regionId : null;
  const countryId =
    Number.isInteger(gameEntry?.countryId) && gameEntry.countryId >= 0 ? gameEntry.countryId : null;

  if (countryId !== null && THE_GAMES_DB_PREFERRED_COUNTRY_IDS.has(countryId)) {
    return 40;
  }

  if (countryId === THE_GAMES_DB_SECONDARY_COUNTRY_ID) {
    return 30;
  }

  if (regionId !== null && THE_GAMES_DB_PREFERRED_REGION_IDS.has(regionId)) {
    return 20;
  }

  if (regionId !== null && THE_GAMES_DB_SECONDARY_REGION_IDS.has(regionId)) {
    return 10;
  }

  return 0;
}

function getTheGamesDbRegionId(game) {
  const value = Number.parseInt(String(game?.region_id ?? ''), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function getTheGamesDbCountryId(game) {
  const value = Number.parseInt(String(game?.country_id ?? ''), 10);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function fetchTheGamesDbBoxArtPayload(title, theGamesDbPlatformId, env, fetchImpl) {
  const apiKey = getTheGamesDbApiKey(env);
  const timeoutMs = getTheGamesDbRequestTimeoutMs(env);
  const normalizedPlatformId =
    Number.isInteger(theGamesDbPlatformId) && theGamesDbPlatformId > 0
      ? theGamesDbPlatformId
      : null;

  if (!apiKey) {
    console.warn('[thegamesdb] missing_api_key');
    return null;
  }

  const searchUrl = new URL('https://api.thegamesdb.net/v1.1/Games/ByGameName');
  searchUrl.searchParams.set('apikey', apiKey);
  searchUrl.searchParams.set('name', title);
  searchUrl.searchParams.set('include', 'boxart');

  if (normalizedPlatformId !== null) {
    searchUrl.searchParams.set('filter[platform]', String(normalizedPlatformId));
  }

  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      searchUrl.toString(),
      { method: 'GET' },
      timeoutMs
    );

    if (!response.ok) {
      let payloadSnippet = '';

      try {
        payloadSnippet = await response.text();
      } catch {
        payloadSnippet = '';
      }

      console.warn('[thegamesdb] request_failed', {
        status: response.status,
        title,
        hasPlatformFilter: normalizedPlatformId !== null,
        payload: payloadSnippet
      });
      return null;
    }

    try {
      return await response.json();
    } catch {
      console.warn('[thegamesdb] invalid_json', {
        title,
        hasPlatformFilter: normalizedPlatformId !== null
      });
      return null;
    }
  } catch (error) {
    console.warn('[thegamesdb] request_exception', {
      title,
      hasPlatformFilter: normalizedPlatformId !== null,
      message: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function searchTheGamesDbBoxArtCandidates(title, platform, platformIgdbId, env, fetchImpl) {
  const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';
  const normalizedPlatformIgdbId =
    Number.isInteger(platformIgdbId) && platformIgdbId > 0 ? platformIgdbId : null;
  const mappedPlatformId =
    normalizedPlatformIgdbId !== null
      ? resolveTheGamesDbPlatformId(normalizedPlatformIgdbId)
      : null;

  if (normalizedPlatformIgdbId !== null && mappedPlatformId === null) {
    console.warn('[thegamesdb] missing_platform_mapping', {
      igdbPlatformId: normalizedPlatformIgdbId,
      platform: normalizedPlatform || null
    });
  }

  const queryCandidates = buildQueryFallbacks(title);

  for (const queryCandidate of queryCandidates) {
    const payload = await fetchTheGamesDbBoxArtPayload(
      queryCandidate,
      mappedPlatformId,
      env,
      fetchImpl
    );
    let candidates = payload
      ? findTheGamesDbBoxArtCandidates(payload, title, normalizedPlatform)
      : [];

    if (candidates.length === 0 && mappedPlatformId !== null) {
      const fallbackPayload = await fetchTheGamesDbBoxArtPayload(
        queryCandidate,
        null,
        env,
        fetchImpl
      );
      candidates = fallbackPayload
        ? findTheGamesDbBoxArtCandidates(fallbackPayload, title, null)
        : [];
    }

    if (candidates.length > 0) {
      return candidates;
    }
  }

  return [];
}

async function fetchAppToken(env, fetchImpl, nowMs) {
  if (tokenCache.accessToken && tokenCache.expiresAt - TOKEN_EXPIRY_BUFFER_MS > nowMs) {
    return tokenCache.accessToken;
  }

  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    throw new Error('Missing Twitch credentials');
  }

  const tokenUrl = new URL('https://id.twitch.tv/oauth2/token');
  tokenUrl.searchParams.set('client_id', env.TWITCH_CLIENT_ID);
  tokenUrl.searchParams.set('client_secret', env.TWITCH_CLIENT_SECRET);
  tokenUrl.searchParams.set('grant_type', 'client_credentials');

  const response = await fetchImpl(tokenUrl.toString(), { method: 'POST' });

  if (!response.ok) {
    throw new Error('Failed to acquire Twitch token');
  }

  const data = await response.json();

  if (!data.access_token || !data.expires_in) {
    throw new Error('Invalid Twitch token response');
  }

  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAt = nowMs + Number(data.expires_in) * 1000;

  return tokenCache.accessToken;
}

async function listIgdbPlatforms(env, token, fetchImpl, nowMs) {
  const timeoutMs = getIgdbRequestTimeoutMs(env);
  if (Array.isArray(igdbPlatformCache.items) && igdbPlatformCache.expiresAt > nowMs) {
    return igdbPlatformCache.items;
  }

  const platformIds = getMappedIgdbPlatformIds();

  if (platformIds.length === 0) {
    igdbPlatformCache.items = [];
    igdbPlatformCache.expiresAt = nowMs + PLATFORM_CACHE_TTL_MS;
    return [];
  }

  const body = [
    `where id = (${platformIds.join(',')});`,
    'fields id,name;',
    `limit ${platformIds.length};`
  ].join(' ');

  const response = await fetchWithTimeout(
    fetchImpl,
    'https://api.igdb.com/v4/platforms',
    {
      method: 'POST',
      headers: {
        'Client-ID': env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body
    },
    timeoutMs
  );

  if (response.status === 429) {
    throw new UpstreamRateLimitError(resolveRetryAfterSecondsFromHeaders(response.headers, nowMs));
  }

  if (!response.ok) {
    throw new Error('IGDB platform request failed');
  }

  const payload = await response.json();

  if (!Array.isArray(payload)) {
    igdbPlatformCache.items = [];
    igdbPlatformCache.expiresAt = nowMs + PLATFORM_CACHE_TTL_MS;
    return [];
  }

  const items = payload
    .map((item) => ({
      id: Number.isInteger(item?.id) && item.id > 0 ? item.id : null,
      name: typeof item?.name === 'string' ? item.name.trim() : ''
    }))
    .filter((item) => item.id !== null && item.name.length > 0)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

  igdbPlatformCache.items = items;
  igdbPlatformCache.expiresAt = nowMs + PLATFORM_CACHE_TTL_MS;
  return items;
}

async function listPopularityTypes(env, token, fetchImpl, nowMs) {
  const timeoutMs = getIgdbRequestTimeoutMs(env);
  if (Array.isArray(igdbPopularityTypeCache.items) && igdbPopularityTypeCache.expiresAt > nowMs) {
    return igdbPopularityTypeCache.items;
  }

  const body = ['fields id,name,external_popularity_source;', 'sort name asc;', 'limit 500;'].join(
    ' '
  );

  const response = await fetchWithTimeout(
    fetchImpl,
    'https://api.igdb.com/v4/popularity_types',
    {
      method: 'POST',
      headers: {
        'Client-ID': env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body
    },
    timeoutMs
  );

  if (response.status === 429) {
    throw new UpstreamRateLimitError(resolveRetryAfterSecondsFromHeaders(response.headers, nowMs));
  }

  if (!response.ok) {
    throw new Error('IGDB popularity type request failed');
  }

  const payload = await response.json();

  if (!Array.isArray(payload)) {
    igdbPopularityTypeCache.items = [];
    igdbPopularityTypeCache.expiresAt = nowMs + POPULARITY_TYPES_CACHE_TTL_MS;
    return [];
  }

  const items = payload
    .map((item) => ({
      id: Number.isInteger(item?.id) && item.id > 0 ? item.id : null,
      name: typeof item?.name === 'string' ? item.name.trim() : '',
      externalPopularitySource:
        Number.isInteger(item?.external_popularity_source) && item.external_popularity_source > 0
          ? item.external_popularity_source
          : null
    }))
    .filter((item) => item.id !== null && item.name.length > 0)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .map((item) => ({
      id: item.id,
      name: item.name,
      externalPopularitySource: item.externalPopularitySource
    }));

  igdbPopularityTypeCache.items = items;
  igdbPopularityTypeCache.expiresAt = nowMs + POPULARITY_TYPES_CACHE_TTL_MS;
  return items;
}

async function fetchIgdbGamesByIds(gameIds, env, token, fetchImpl, nowMs) {
  const timeoutMs = getIgdbRequestTimeoutMs(env);
  if (!Array.isArray(gameIds) || gameIds.length === 0) {
    return [];
  }

  const uniqueIds = [
    ...new Set(
      gameIds
        .map((value) => Number.parseInt(String(value ?? ''), 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  ];

  if (uniqueIds.length === 0) {
    return [];
  }

  const body = [
    `where id = (${uniqueIds.join(',')});`,
    'fields id,name,storyline,summary,first_release_date,cover.image_id,platforms.id,platforms.name,game_type.type,similar_games,collections.name,franchises.name,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name;',
    `limit ${uniqueIds.length};`
  ].join(' ');

  const response = await fetchWithTimeout(
    fetchImpl,
    'https://api.igdb.com/v4/games',
    {
      method: 'POST',
      headers: {
        'Client-ID': env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body
    },
    timeoutMs
  );

  if (response.status === 429) {
    throw new UpstreamRateLimitError(resolveRetryAfterSecondsFromHeaders(response.headers, nowMs));
  }

  if (!response.ok) {
    throw new Error('IGDB popularity game request failed');
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function listPopularityPrimitives(
  popularityTypeId,
  limit,
  offset,
  env,
  token,
  fetchImpl,
  nowMs
) {
  const timeoutMs = getIgdbRequestTimeoutMs(env);
  const normalizedPopularityTypeId =
    Number.isInteger(popularityTypeId) && popularityTypeId > 0 ? popularityTypeId : null;

  if (normalizedPopularityTypeId === null) {
    return [];
  }

  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
  const normalizedOffset = Number.isInteger(offset) ? Math.max(offset, 0) : 0;

  const primitivesBody = [
    `where popularity_type = ${normalizedPopularityTypeId} & game_id != null;`,
    'fields game_id,popularity_type,external_popularity_source,value,calculated_at;',
    'sort value desc;',
    `limit ${normalizedLimit};`,
    `offset ${normalizedOffset};`
  ].join(' ');

  const primitivesResponse = await fetchWithTimeout(
    fetchImpl,
    'https://api.igdb.com/v4/popularity_primitives',
    {
      method: 'POST',
      headers: {
        'Client-ID': env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body: primitivesBody
    },
    timeoutMs
  );

  if (primitivesResponse.status === 429) {
    throw new UpstreamRateLimitError(
      resolveRetryAfterSecondsFromHeaders(primitivesResponse.headers, nowMs)
    );
  }

  if (!primitivesResponse.ok) {
    throw new Error('IGDB popularity primitive request failed');
  }

  const primitivePayload = await primitivesResponse.json();
  const primitives = Array.isArray(primitivePayload)
    ? primitivePayload
        .map((item) => ({
          gameId: Number.isInteger(item?.game_id) && item.game_id > 0 ? item.game_id : null,
          popularityType:
            Number.isInteger(item?.popularity_type) && item.popularity_type > 0
              ? item.popularity_type
              : null,
          externalPopularitySource:
            Number.isInteger(item?.external_popularity_source) &&
            item.external_popularity_source > 0
              ? item.external_popularity_source
              : null,
          value: normalizeNumericValue(item?.value),
          calculatedAt: normalizeIgdbUnixDatetime(item?.calculated_at)
        }))
        .filter((item) => item.gameId !== null && item.popularityType !== null)
    : [];

  if (primitives.length === 0) {
    return [];
  }

  const rawGames = await fetchIgdbGamesByIds(
    primitives.map((item) => item.gameId),
    env,
    token,
    fetchImpl,
    nowMs
  );
  const gamesById = new Map(
    rawGames
      .map((item) => {
        const id = Number.isInteger(item?.id) && item.id > 0 ? item.id : null;

        if (id === null) {
          return null;
        }

        return [id, normalizeIgdbGame(item)];
      })
      .filter(Boolean)
  );

  return primitives
    .map((item) => {
      const game = gamesById.get(item.gameId);

      if (!game) {
        return null;
      }

      return {
        game,
        popularityType: item.popularityType,
        externalPopularitySource: item.externalPopularitySource,
        value: item.value,
        calculatedAt: item.calculatedAt
      };
    })
    .filter(Boolean);
}

async function searchIgdb(query, platformIgdbId, env, token, fetchImpl, nowMs) {
  const timeoutMs = getIgdbRequestTimeoutMs(env);
  const normalizedPlatformIgdbId =
    Number.isInteger(platformIgdbId) && platformIgdbId > 0 ? platformIgdbId : null;
  const queryVariants = [
    {
      fields:
        'id,name,storyline,summary,first_release_date,cover.image_id,platforms.id,platforms.name,total_rating_count,game_type.type,parent_game,similar_games,collections.name,franchises.name,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name',
      sort: null
    },
    {
      fields:
        'id,name,storyline,summary,first_release_date,cover.image_id,platforms.id,platforms.name,rating_count,game_type.type,parent_game,similar_games,collections.name,franchises.name,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name',
      sort: null
    },
    {
      fields:
        'id,name,storyline,summary,first_release_date,cover.image_id,platforms.id,platforms.name,game_type.type,parent_game,similar_games,collections.name,franchises.name,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name',
      sort: null
    }
  ];
  const requestHeaders = {
    'Client-ID': env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'text/plain'
  };
  const queryCandidates = buildQueryFallbacks(query);
  const mergedResults = [];
  const mergedResultIds = new Set();
  let hadSuccessfulPayload = false;
  const platformConstraints =
    normalizedPlatformIgdbId !== null ? [normalizedPlatformIgdbId, null] : [null];

  if (igdbSearchVariantCache.disabledVariants.size >= queryVariants.length) {
    igdbSearchVariantCache.disabledVariants.clear();
    igdbSearchVariantCache.preferredVariantIndex = 0;
  }

  const variantIndexes = queryVariants
    .map((_, index) => index)
    .filter((index) => !igdbSearchVariantCache.disabledVariants.has(index));
  const preferredIndexPosition = variantIndexes.indexOf(
    igdbSearchVariantCache.preferredVariantIndex
  );

  if (preferredIndexPosition > 0) {
    variantIndexes.splice(preferredIndexPosition, 1);
    variantIndexes.unshift(igdbSearchVariantCache.preferredVariantIndex);
  }

  for (
    let platformConstraintAttempt = 0;
    platformConstraintAttempt < platformConstraints.length;
    platformConstraintAttempt += 1
  ) {
    const platformConstraint = platformConstraints[platformConstraintAttempt];

    for (let queryAttempt = 0; queryAttempt < queryCandidates.length; queryAttempt += 1) {
      const queryCandidate = queryCandidates[queryAttempt];

      for (let attempt = 0; attempt < variantIndexes.length; attempt += 1) {
        const variantIndex = variantIndexes[attempt];
        const variant = queryVariants[variantIndex];
        const bodyParts = [`search "${escapeQuery(queryCandidate)}";`, `fields ${variant.fields};`];

        if (platformConstraint !== null) {
          bodyParts.push(`where platforms = (${platformConstraint});`);
        }

        if (variant.sort) {
          bodyParts.push(`sort ${variant.sort};`);
        }

        bodyParts.push('limit 25;');

        const body = bodyParts.join(' ');
        const response = await fetchWithTimeout(
          fetchImpl,
          'https://api.igdb.com/v4/games',
          {
            method: 'POST',
            headers: requestHeaders,
            body
          },
          timeoutMs
        );

        if (response.status === 429) {
          throw new UpstreamRateLimitError(
            resolveRetryAfterSecondsFromHeaders(response.headers, nowMs)
          );
        }

        if (!response.ok) {
          let payloadSnippet = '';

          try {
            payloadSnippet = await response.text();
          } catch {
            payloadSnippet = '';
          }

          console.warn('[igdb] search_variant_failed', {
            attempt: attempt + 1,
            queryAttempt: queryAttempt + 1,
            platformConstraintAttempt: platformConstraintAttempt + 1,
            platformConstraint,
            variantIndex: variantIndex + 1,
            status: response.status,
            payload: payloadSnippet,
            sort: variant.sort
          });

          if (response.status === 400 && payloadSnippet.toLowerCase().includes('invalid field')) {
            igdbSearchVariantCache.disabledVariants.add(variantIndex);
          }

          continue;
        }

        let data;

        try {
          data = await response.json();
        } catch {
          console.warn('[igdb] search_variant_invalid_json', {
            attempt: attempt + 1,
            queryAttempt: queryAttempt + 1,
            platformConstraintAttempt: platformConstraintAttempt + 1,
            platformConstraint,
            variantIndex: variantIndex + 1
          });
          continue;
        }

        if (!Array.isArray(data)) {
          console.warn('[igdb] search_variant_invalid_payload', {
            attempt: attempt + 1,
            queryAttempt: queryAttempt + 1,
            platformConstraintAttempt: platformConstraintAttempt + 1,
            platformConstraint,
            variantIndex: variantIndex + 1
          });
          continue;
        }

        hadSuccessfulPayload = true;
        igdbSearchVariantCache.preferredVariantIndex = variantIndex;
        const normalizedResults = sortIgdbSearchResults(data).map(normalizeIgdbGame);

        normalizedResults.forEach((result) => {
          const resultId = String(result?.igdbGameId ?? result?.externalId ?? '').trim();

          if (!resultId || mergedResultIds.has(resultId)) {
            return;
          }

          mergedResultIds.add(resultId);
          mergedResults.push(result);
        });

        break;
      }
    }

    if (mergedResults.length > 0) {
      break;
    }
  }

  if (mergedResults.length > 0) {
    return mergedResults;
  }

  if (hadSuccessfulPayload) {
    return [];
  }

  throw new Error('IGDB request failed');
}

async function fetchIgdbById(gameId, env, token, fetchImpl, nowMs) {
  const timeoutMs = getIgdbRequestTimeoutMs(env);
  const body = [
    `where id = ${gameId};`,
    'fields id,name,storyline,summary,first_release_date,cover.image_id,platforms.id,platforms.name,game_type.type,similar_games,collections.name,franchises.name,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name;',
    'limit 1;'
  ].join(' ');

  const response = await fetchWithTimeout(
    fetchImpl,
    'https://api.igdb.com/v4/games',
    {
      method: 'POST',
      headers: {
        'Client-ID': env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain'
      },
      body
    },
    timeoutMs
  );

  if (response.status === 429) {
    throw new UpstreamRateLimitError(resolveRetryAfterSecondsFromHeaders(response.headers, nowMs));
  }

  if (!response.ok) {
    throw new Error('IGDB request failed');
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return normalizeIgdbGame(data[0]);
}

export async function handleRequest(request, env, fetchImpl = fetch, now = () => Date.now()) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);

  const gameId = normalizeGameIdFromPath(url.pathname);
  const isGameSearchPath = url.pathname === '/v1/games/search';
  const isPlatformListPath = url.pathname === '/v1/platforms';
  const isPopularityTypesPath = url.pathname === '/v1/popularity/types';
  const isPopularityPrimitivesPath = url.pathname === '/v1/popularity/primitives';
  const isGameByIdPath = gameId !== null;
  const isBoxArtSearchRoute = isBoxArtSearchPath(url.pathname);
  const debugHttp = shouldLogHttp(env, url);
  const loggedFetch = createLoggedFetch(fetchImpl, debugHttp);

  if (
    !isGameSearchPath &&
    !isPlatformListPath &&
    !isPopularityTypesPath &&
    !isPopularityPrimitivesPath &&
    !isGameByIdPath &&
    !isBoxArtSearchRoute
  ) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  if (isGameSearchPath || isBoxArtSearchRoute) {
    const query = normalizeSearchQuery(url);

    if (query.length < 2) {
      return jsonResponse({ error: 'Query must be at least 2 characters.' }, 400);
    }
  }

  const nowMs = now();
  const ipAddress =
    request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  const isIgdbRoute =
    isGameSearchPath ||
    isPlatformListPath ||
    isPopularityTypesPath ||
    isPopularityPrimitivesPath ||
    isGameByIdPath;

  const localRetryAfterSeconds = getLocalRateLimitRetryAfterSeconds(ipAddress, nowMs);

  if (localRetryAfterSeconds !== null) {
    return jsonResponse(
      { error: `Rate limit exceeded. Retry after ${localRetryAfterSeconds}s.` },
      429,
      { 'Retry-After': String(localRetryAfterSeconds) }
    );
  }

  if (isIgdbRoute) {
    const upstreamRetryAfterSeconds = getUpstreamCooldownRemainingSeconds(nowMs);

    if (upstreamRetryAfterSeconds > 0) {
      return jsonResponse(
        { error: `Rate limit exceeded. Retry after ${upstreamRetryAfterSeconds}s.` },
        429,
        { 'Retry-After': String(upstreamRetryAfterSeconds) }
      );
    }
  }

  try {
    if (isBoxArtSearchRoute) {
      const query = normalizeSearchQuery(url);
      const platform = normalizePlatformQuery(url);
      const platformIgdbId = normalizePlatformIgdbIdQuery(url);
      const items = await searchTheGamesDbBoxArtCandidates(
        query,
        platform,
        platformIgdbId,
        env,
        loggedFetch
      );
      return jsonResponse({ items }, 200);
    }

    const token = await fetchAppToken(env, loggedFetch, nowMs);

    if (isPlatformListPath) {
      const items = await listIgdbPlatforms(env, token, loggedFetch, nowMs);
      return jsonResponse({ items }, 200);
    }

    if (isPopularityTypesPath) {
      const items = await listPopularityTypes(env, token, loggedFetch, nowMs);
      return jsonResponse({ items }, 200);
    }

    if (isPopularityPrimitivesPath) {
      const popularityTypeId = normalizePopularityTypeIdQuery(url);

      if (popularityTypeId === null) {
        return jsonResponse({ error: 'popularityTypeId must be a positive integer.' }, 400);
      }

      const limit = normalizeLimitQuery(url, 20);
      const offset = normalizeOffsetQuery(url);
      const items = await listPopularityPrimitives(
        popularityTypeId,
        limit,
        offset,
        env,
        token,
        loggedFetch,
        nowMs
      );
      return jsonResponse({ items }, 200);
    }

    if (isGameSearchPath) {
      const query = normalizeSearchQuery(url);
      const platformIgdbId = normalizePlatformIgdbIdQuery(url);

      const items = await searchIgdb(query, platformIgdbId, env, token, loggedFetch, nowMs);
      return jsonResponse({ items }, 200);
    }

    const item = await fetchIgdbById(gameId, env, token, loggedFetch, nowMs);

    if (!item) {
      return jsonResponse({ error: 'Game not found.' }, 404);
    }

    return jsonResponse({ item }, 200);
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) {
      const retryAfterSeconds = setUpstreamCooldown(error.retryAfterSeconds, nowMs);
      return jsonResponse(
        { error: `Rate limit exceeded. Retry after ${retryAfterSeconds}s.` },
        429,
        { 'Retry-After': String(retryAfterSeconds) }
      );
    }

    console.error('[worker] request_failed', error);
    return jsonResponse({ error: 'Unable to fetch game data.' }, 502);
  }
}
