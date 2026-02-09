import { IGDB_TO_THEGAMESDB_PLATFORM_ID } from './platform-id-map.mjs';

const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const MAX_BOX_ART_RESULTS = 30;
const IGDB_CATEGORY_REMAKE = 8;
const IGDB_CATEGORY_REMASTER = 9;

const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

const rateLimitCache = new Map();
const igdbSearchVariantCache = {
  preferredVariantIndex: 0,
  disabledVariants: new Set(),
};

export function resetCaches() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
  rateLimitCache.clear();
  igdbSearchVariantCache.preferredVariantIndex = 0;
  igdbSearchVariantCache.disabledVariants.clear();
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
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
    game?.follows,
    game?.rating_count,
    game?.hypes,
    game?.aggregated_rating_count,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return Number.NEGATIVE_INFINITY;
}

function isRemakeOrRemaster(category) {
  const normalized = typeof category === 'number' ? category : Number.NaN;
  return normalized === IGDB_CATEGORY_REMAKE || normalized === IGDB_CATEGORY_REMASTER;
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
    isRemakeOrRemaster: isRemakeOrRemaster(game?.category),
  }));

  const idSet = new Set(indexed.map(entry => entry.id).filter(Boolean));

  indexed.sort((left, right) => {
    if (left.rankScore !== right.rankScore) {
      return right.rankScore - left.rankScore;
    }

    return left.index - right.index;
  });

  const byId = new Map(indexed.map((entry, index) => [entry.id, index]));

  indexed.forEach(entry => {
    if (!entry.isRemakeOrRemaster || !entry.originalId || !idSet.has(entry.originalId)) {
      return;
    }

    let remakeIndex = byId.get(entry.id);
    let originalIndex = byId.get(entry.originalId);

    if (typeof remakeIndex !== 'number' || typeof originalIndex !== 'number' || remakeIndex > originalIndex) {
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

  return indexed.map(entry => entry.game);
}

function isBoxArtSearchPath(pathname) {
  return pathname === '/v1/images/boxart/search';
}

function isRateLimited(ipAddress, nowMs) {
  const key = ipAddress || 'unknown';
  const entry = rateLimitCache.get(key);

  if (!entry || nowMs - entry.startedAt > RATE_LIMIT_WINDOW_MS) {
    rateLimitCache.set(key, { startedAt: nowMs, count: 1 });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  entry.count += 1;
  return false;
}

function escapeQuery(query) {
  return query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
      .map(platform => {
        const name = typeof platform?.name === 'string' ? platform.name.trim() : '';
        const id = Number.isFinite(platform?.id) ? Math.trunc(platform.id) : null;
        return {
          id: Number.isInteger(id) && id > 0 ? id : null,
          name,
        };
      })
      .filter(platform => platform.name.length > 0)
      .filter((platform, index, items) => {
        return items.findIndex(candidate => candidate.id === platform.id && candidate.name === platform.name) === index;
      })
    : [];
  const platforms = [...new Set(platformOptions.map(platform => platform.name))];
  const releaseYear = Number.isFinite(game.first_release_date)
    ? new Date(game.first_release_date * 1000).getUTCFullYear()
    : null;
  const releaseDate = Number.isFinite(game.first_release_date)
    ? new Date(game.first_release_date * 1000).toISOString()
    : null;

  return {
    externalId: String(game.id ?? '').trim(),
    title: typeof game.name === 'string' && game.name.trim().length > 0 ? game.name.trim() : 'Unknown title',
    coverUrl: buildCoverUrl(game.cover?.image_id ?? null),
    coverSource: game.cover?.image_id ? 'igdb' : 'none',
    platforms,
    platformOptions,
    platform: platforms.length === 1 ? platforms[0] : null,
    platformIgdbId: platformOptions.length === 1 ? platformOptions[0].id : null,
    releaseDate,
    releaseYear,
  };
}

function getTheGamesDbApiKey(env) {
  return typeof env.THEGAMESDB_API_KEY === 'string' && env.THEGAMESDB_API_KEY.trim().length > 0
    ? env.THEGAMESDB_API_KEY.trim()
    : null;
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
  return String(title ?? '')
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
  return String(platform ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTheGamesDbPlatformText(game) {
  const candidates = [
    game?.platform,
    game?.platform_name,
    game?.platformName,
    game?.system,
    game?.system_name,
  ];

  return candidates
    .filter(value => typeof value === 'string' && value.trim().length > 0)
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
  const intersectionCount = [...expectedTokenSet].filter(token => candidateTokenSet.has(token)).length;
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

  const games = Array.isArray(root?.games) ? root.games : [];

  if (games.length === 0) {
    return [];
  }

  const rankedGames = games
    .map(game => ({
      gameId: getTheGamesDbGameId(game),
      score: getTitleSimilarityScore(expectedTitle, getTheGamesDbGameTitle(game)),
      platformText: getTheGamesDbPlatformText(game),
    }))
    .filter(entry => entry.gameId.length > 0 && Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  if (rankedGames.length === 0) {
    return [];
  }

  const boxartRoot = includeRoot?.boxart;
  const baseUrl = boxartRoot?.base_url?.original
    || boxartRoot?.base_url?.large
    || boxartRoot?.base_url?.medium
    || null;

  if (!baseUrl) {
    return [];
  }

  const dataByGame = boxartRoot?.data ?? {};
  const scoredByUrl = new Map();

  rankedGames.forEach((gameEntry, gameIndex) => {
    const candidates = Array.isArray(dataByGame[gameEntry.gameId]) ? dataByGame[gameEntry.gameId] : [];

    candidates.forEach(candidate => {
      const imageType = typeof candidate?.type === 'string' ? candidate.type.toLowerCase() : '';
      const imageSide = typeof candidate?.side === 'string' ? candidate.side.toLowerCase() : '';
      const filename = candidate?.filename ?? candidate?.thumb ?? null;
      const url = normalizeTheGamesDbUrl(filename, baseUrl);

      if (!url || !imageType.includes('boxart')) {
        return;
      }

      let score = gameEntry.score;
      score += Math.max(0, rankedGames.length - gameIndex);

      if (imageSide === 'front') {
        score += 10;
      }

      if (normalizedPreferredPlatform.length > 0) {
        const normalizedGamePlatform = normalizePlatformForMatch(gameEntry.platformText);

        if (normalizedGamePlatform.includes(normalizedPreferredPlatform)) {
          score += 20;
        }
      }

      const existingScore = scoredByUrl.get(url);

      if (typeof existingScore !== 'number' || score > existingScore) {
        scoredByUrl.set(url, score);
      }
    });
  });

  return [...scoredByUrl.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(entry => entry[0])
    .slice(0, MAX_BOX_ART_RESULTS);
}

async function fetchTheGamesDbBoxArtPayload(title, theGamesDbPlatformId, env, fetchImpl) {
  const apiKey = getTheGamesDbApiKey(env);
  const normalizedPlatformId = Number.isInteger(theGamesDbPlatformId) && theGamesDbPlatformId > 0
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
    const response = await fetchImpl(searchUrl.toString(), { method: 'GET' });

    if (!response.ok) {
      let payloadSnippet = '';

      try {
        payloadSnippet = (await response.text()).slice(0, 300);
      } catch {
        payloadSnippet = '';
      }

      console.warn('[thegamesdb] request_failed', {
        status: response.status,
        title,
        hasPlatformFilter: normalizedPlatformId !== null,
        payload: payloadSnippet,
      });
      return null;
    }

    try {
      return await response.json();
    } catch {
      console.warn('[thegamesdb] invalid_json', {
        title,
        hasPlatformFilter: normalizedPlatformId !== null,
      });
      return null;
    }
  } catch (error) {
    console.warn('[thegamesdb] request_exception', {
      title,
      hasPlatformFilter: normalizedPlatformId !== null,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function searchTheGamesDbBoxArtCandidates(title, platform, platformIgdbId, env, fetchImpl) {
  const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';
  const normalizedPlatformIgdbId = Number.isInteger(platformIgdbId) && platformIgdbId > 0
    ? platformIgdbId
    : null;
  const mappedPlatformId = normalizedPlatformIgdbId !== null
    ? resolveTheGamesDbPlatformId(normalizedPlatformIgdbId)
    : null;

  if (normalizedPlatformIgdbId !== null && mappedPlatformId === null) {
    console.warn('[thegamesdb] missing_platform_mapping', {
      igdbPlatformId: normalizedPlatformIgdbId,
      platform: normalizedPlatform || null,
    });
  }

  const payload = await fetchTheGamesDbBoxArtPayload(title, mappedPlatformId, env, fetchImpl);
  let candidates = payload ? findTheGamesDbBoxArtCandidates(payload, title, normalizedPlatform) : [];

  if (candidates.length === 0 && mappedPlatformId !== null) {
    const fallbackPayload = await fetchTheGamesDbBoxArtPayload(title, null, env, fetchImpl);
    candidates = fallbackPayload ? findTheGamesDbBoxArtCandidates(fallbackPayload, title, null) : [];
  }

  return candidates;
}

async function fetchAppToken(env, fetchImpl, nowMs) {
  if (
    tokenCache.accessToken
    && tokenCache.expiresAt - TOKEN_EXPIRY_BUFFER_MS > nowMs
  ) {
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

async function searchIgdb(query, env, token, fetchImpl) {
  const queryVariants = [
    {
      fields: 'id,name,first_release_date,cover.image_id,platforms.id,platforms.name,total_rating_count,category,parent_game',
      sort: null,
    },
    {
      fields: 'id,name,first_release_date,cover.image_id,platforms.id,platforms.name,follows,category,parent_game',
      sort: null,
    },
    {
      fields: 'id,name,first_release_date,cover.image_id,platforms.id,platforms.name,category,parent_game',
      sort: null,
    },
  ];
  const requestHeaders = {
    'Client-ID': env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'text/plain',
  };

  if (igdbSearchVariantCache.disabledVariants.size >= queryVariants.length) {
    igdbSearchVariantCache.disabledVariants.clear();
    igdbSearchVariantCache.preferredVariantIndex = 0;
  }

  const variantIndexes = queryVariants
    .map((_, index) => index)
    .filter(index => !igdbSearchVariantCache.disabledVariants.has(index));
  const preferredIndexPosition = variantIndexes.indexOf(igdbSearchVariantCache.preferredVariantIndex);

  if (preferredIndexPosition > 0) {
    variantIndexes.splice(preferredIndexPosition, 1);
    variantIndexes.unshift(igdbSearchVariantCache.preferredVariantIndex);
  }

  for (let attempt = 0; attempt < variantIndexes.length; attempt += 1) {
    const variantIndex = variantIndexes[attempt];
    const variant = queryVariants[variantIndex];
    const bodyParts = [
      `search "${escapeQuery(query)}";`,
      `fields ${variant.fields};`,
    ];

    if (variant.sort) {
      bodyParts.push(`sort ${variant.sort};`);
    }

    bodyParts.push(
      'limit 25;',
    );

    const body = bodyParts.join(' ');
    const response = await fetchImpl('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: requestHeaders,
      body,
    });

    if (!response.ok) {
      let payloadSnippet = '';

      try {
        payloadSnippet = (await response.text()).slice(0, 300);
      } catch {
        payloadSnippet = '';
      }

      console.warn('[igdb] search_variant_failed', {
        attempt: attempt + 1,
        variantIndex: variantIndex + 1,
        status: response.status,
        payload: payloadSnippet,
        sort: variant.sort,
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
        variantIndex: variantIndex + 1,
      });
      continue;
    }

    if (!Array.isArray(data)) {
      console.warn('[igdb] search_variant_invalid_payload', {
        attempt: attempt + 1,
        variantIndex: variantIndex + 1,
      });
      continue;
    }

    igdbSearchVariantCache.preferredVariantIndex = variantIndex;
    return sortIgdbSearchResults(data).map(normalizeIgdbGame);
  }

  throw new Error('IGDB request failed');
}

async function fetchIgdbById(gameId, env, token, fetchImpl) {
  const body = [
    `where id = ${gameId};`,
    'fields id,name,first_release_date,cover.image_id,platforms.id,platforms.name;',
    'limit 1;',
  ].join(' ');

  const response = await fetchImpl('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });

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
  if (request.method === 'OPTIONS') {
    return jsonResponse({}, 204);
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);

  const gameId = normalizeGameIdFromPath(url.pathname);
  const isGameSearchPath = url.pathname === '/v1/games/search';
  const isGameByIdPath = gameId !== null;
  const isBoxArtSearchRoute = isBoxArtSearchPath(url.pathname);

  if (!isGameSearchPath && !isGameByIdPath && !isBoxArtSearchRoute) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  if (isGameSearchPath || isBoxArtSearchRoute) {
    const query = normalizeSearchQuery(url);

    if (query.length < 2) {
      return jsonResponse({ error: 'Query must be at least 2 characters.' }, 400);
    }
  }

  const nowMs = now();
  const ipAddress = request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';

  if (isRateLimited(ipAddress, nowMs)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  try {
    if (isBoxArtSearchRoute) {
      const query = normalizeSearchQuery(url);
      const platform = normalizePlatformQuery(url);
      const platformIgdbId = normalizePlatformIgdbIdQuery(url);
      const items = await searchTheGamesDbBoxArtCandidates(query, platform, platformIgdbId, env, fetchImpl);
      return jsonResponse({ items }, 200);
    }

    const token = await fetchAppToken(env, fetchImpl, nowMs);

    if (isGameSearchPath) {
      const query = normalizeSearchQuery(url);

      const items = await searchIgdb(query, env, token, fetchImpl);
      return jsonResponse({ items }, 200);
    }

    const item = await fetchIgdbById(gameId, env, token, fetchImpl);

    if (!item) {
      return jsonResponse({ error: 'Game not found.' }, 404);
    }

    return jsonResponse({ item }, 200);
  } catch (error) {
    console.error('[worker] request_failed', error);
    return jsonResponse({ error: 'Unable to fetch game data.' }, 502);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
