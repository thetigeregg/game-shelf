const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

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

  return {
    externalId: String(game.id ?? '').trim(),
    title: typeof game.name === 'string' && game.name.trim().length > 0 ? game.name.trim() : 'Unknown title',
    coverUrl: buildCoverUrl(game.cover?.image_id ?? null),
    platforms,
    platform: platforms.length === 1 ? platforms[0] : null,
    releaseYear,
  };
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

export async function handleRequest(request, env, fetchImpl = fetch, now = () => Date.now()) {
  if (request.method === 'OPTIONS') {
    return jsonResponse({}, 204);
  }

  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);

  if (url.pathname !== '/v1/games/search') {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const query = normalizeSearchQuery(url);

  if (query.length < 2) {
    return jsonResponse({ error: 'Query must be at least 2 characters.' }, 400);
  }

  const nowMs = now();
  const ipAddress = request.headers.get('CF-Connecting-IP') ?? request.headers.get('x-forwarded-for') ?? 'unknown';

  if (isRateLimited(ipAddress, nowMs)) {
    return jsonResponse({ error: 'Rate limit exceeded.' }, 429);
  }

  try {
    const token = await fetchAppToken(env, fetchImpl, nowMs);
    const items = await searchIgdb(query, env, token, fetchImpl);
    return jsonResponse({ items }, 200);
  } catch {
    return jsonResponse({ error: 'Unable to fetch game data.' }, 502);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
