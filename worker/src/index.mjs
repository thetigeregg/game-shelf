const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const MAX_BOX_ART_RESULTS = 30;

const tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

const rateLimitCache = new Map();

export function resetCaches() {
  tokenCache.accessToken = null;
  tokenCache.expiresAt = 0;
  rateLimitCache.clear();
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

function normalizeGameIdFromPath(pathname) {
  const match = pathname.match(/^\/v1\/games\/(\d+)$/);
  return match ? match[1] : null;
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
  const platforms = Array.isArray(game.platforms)
    ? [...new Set(
      game.platforms
        .map(platform => typeof platform?.name === 'string' ? platform.name.trim() : '')
        .filter(name => name.length > 0)
    )]
    : [];
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
    platform: platforms.length === 1 ? platforms[0] : null,
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

async function fetchTheGamesDbBoxArtPayload(title, platform, env, fetchImpl) {
  const apiKey = getTheGamesDbApiKey(env);

  if (!apiKey) {
    throw new Error('Missing TheGamesDB API key');
  }

  const searchUrl = new URL('https://api.thegamesdb.net/v1.1/Games/ByGameName');
  searchUrl.searchParams.set('apikey', apiKey);
  searchUrl.searchParams.set('name', title);
  searchUrl.searchParams.set('include', 'boxart');
  const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';

  if (normalizedPlatform.length > 0) {
    searchUrl.searchParams.set('filter[platform]', normalizedPlatform);
  }

  const response = await fetchImpl(searchUrl.toString(), { method: 'GET' });

  if (!response.ok) {
    throw new Error('TheGamesDB request failed');
  }

  return response.json();
}

async function searchTheGamesDbBoxArtCandidates(title, platform, env, fetchImpl) {
  const normalizedPlatform = typeof platform === 'string' ? platform.trim() : '';
  const payload = await fetchTheGamesDbBoxArtPayload(title, normalizedPlatform, env, fetchImpl);
  let candidates = findTheGamesDbBoxArtCandidates(payload, title, normalizedPlatform);

  if (candidates.length === 0 && normalizedPlatform.length > 0) {
    const fallbackPayload = await fetchTheGamesDbBoxArtPayload(title, null, env, fetchImpl);
    candidates = findTheGamesDbBoxArtCandidates(fallbackPayload, title, null);
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
  const body = [
    `search "${escapeQuery(query)}";`,
    'fields id,name,first_release_date,cover.image_id,platforms.name;',
    'limit 25;',
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
  return Array.isArray(data) ? data.map(normalizeIgdbGame) : [];
}

async function fetchIgdbById(gameId, env, token, fetchImpl) {
  const body = [
    `where id = ${gameId};`,
    'fields id,name,first_release_date,cover.image_id,platforms.name;',
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
      const items = await searchTheGamesDbBoxArtCandidates(query, platform, env, fetchImpl);
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
  } catch {
    return jsonResponse({ error: 'Unable to fetch game data.' }, 502);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
