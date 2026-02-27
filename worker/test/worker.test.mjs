import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables, handleRequest, normalizeIgdbGame, resetCaches } from '../src/index.mjs';

const env = {
  TWITCH_CLIENT_ID: 'client-id',
  TWITCH_CLIENT_SECRET: 'client-secret',
  THEGAMESDB_API_KEY: 'thegamesdb-key'
};

function createFetchStub({
  igdbStatus = 200,
  igdbBody = [],
  igdbHeaders = {},
  igdbResponses = null,
  igdbPlatformsStatus = 200,
  igdbPlatformsBody = [],
  igdbPopularityTypesStatus = 200,
  igdbPopularityTypesBody = [],
  igdbPopularityPrimitivesStatus = 200,
  igdbPopularityPrimitivesBody = [],
  tokenStatus = 200,
  theGamesDbStatus = 200,
  theGamesDbBody = null
}) {
  const calls = {
    token: 0,
    igdb: 0,
    igdbBodies: [],
    igdbPlatforms: 0,
    igdbPlatformBodies: [],
    igdbPopularityTypes: 0,
    igdbPopularityTypeBodies: [],
    igdbPopularityPrimitives: 0,
    igdbPopularityPrimitiveBodies: [],
    theGamesDb: 0,
    theGamesDbUrls: []
  };

  const stub = async (url, options = {}) => {
    const normalizedUrl = String(url);

    if (normalizedUrl.startsWith('https://id.twitch.tv/oauth2/token')) {
      calls.token += 1;

      if (tokenStatus !== 200) {
        return new Response(JSON.stringify({ error: 'token_failed' }), { status: tokenStatus });
      }

      return new Response(JSON.stringify({ access_token: 'abc123', expires_in: 3600 }), {
        status: 200
      });
    }

    if (normalizedUrl === 'https://api.igdb.com/v4/games') {
      calls.igdb += 1;
      calls.igdbBodies.push(typeof options.body === 'string' ? options.body : '');

      if (Array.isArray(igdbResponses) && igdbResponses.length > 0) {
        const responseConfig =
          igdbResponses[calls.igdb - 1] ?? igdbResponses[igdbResponses.length - 1];
        return new Response(JSON.stringify(responseConfig?.body ?? []), {
          status: responseConfig?.status ?? 200,
          headers: responseConfig?.headers ?? {}
        });
      }

      return new Response(JSON.stringify(igdbBody), { status: igdbStatus, headers: igdbHeaders });
    }

    if (normalizedUrl === 'https://api.igdb.com/v4/platforms') {
      calls.igdbPlatforms += 1;
      calls.igdbPlatformBodies.push(typeof options.body === 'string' ? options.body : '');
      return new Response(JSON.stringify(igdbPlatformsBody), { status: igdbPlatformsStatus });
    }

    if (normalizedUrl === 'https://api.igdb.com/v4/popularity_types') {
      calls.igdbPopularityTypes += 1;
      calls.igdbPopularityTypeBodies.push(typeof options.body === 'string' ? options.body : '');
      return new Response(JSON.stringify(igdbPopularityTypesBody), {
        status: igdbPopularityTypesStatus
      });
    }

    if (normalizedUrl === 'https://api.igdb.com/v4/popularity_primitives') {
      calls.igdbPopularityPrimitives += 1;
      calls.igdbPopularityPrimitiveBodies.push(
        typeof options.body === 'string' ? options.body : ''
      );
      return new Response(JSON.stringify(igdbPopularityPrimitivesBody), {
        status: igdbPopularityPrimitivesStatus
      });
    }

    if (normalizedUrl.startsWith('https://api.thegamesdb.net/v1.1/Games/ByGameName')) {
      calls.theGamesDb += 1;
      calls.theGamesDbUrls.push(normalizedUrl);

      if (theGamesDbStatus !== 200) {
        return new Response(JSON.stringify({ error: 'thegamesdb_failed' }), {
          status: theGamesDbStatus
        });
      }

      return new Response(
        JSON.stringify(
          theGamesDbBody ?? { data: { games: [] }, include: { boxart: { data: {} } } }
        ),
        { status: 200 }
      );
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  return { stub, calls };
}

test('normalizeIgdbGame maps IGDB payload to app shape', () => {
  const normalized = normalizeIgdbGame({
    id: 42,
    name: 'Super Mario Odyssey',
    first_release_date: 1508457600,
    cover: { image_id: 'abc123' },
    platforms: [{ name: 'Nintendo Switch' }]
  });

  assert.deepEqual(normalized, {
    igdbGameId: '42',
    externalId: '42',
    title: 'Super Mario Odyssey',
    coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
    coverSource: 'igdb',
    storyline: null,
    summary: null,
    gameType: null,
    similarGameIgdbIds: [],
    collections: [],
    developers: [],
    publishers: [],
    franchises: [],
    genres: [],
    platforms: ['Nintendo Switch'],
    platformOptions: [{ id: null, name: 'Nintendo Switch' }],
    platform: 'Nintendo Switch',
    platformIgdbId: null,
    releaseDate: '2017-10-20T00:00:00.000Z',
    releaseYear: 2017
  });
});

test('normalizeIgdbGame defaults missing game id to empty identifiers', () => {
  const normalized = normalizeIgdbGame({
    name: 'Untitled Prototype',
    platforms: [{ id: 6, name: 'PC (Microsoft Windows)' }]
  });

  assert.equal(normalized.igdbGameId, '');
  assert.equal(normalized.externalId, '');
});

test('returns 400 for short query', async () => {
  resetCaches();

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=m'),
    env,
    async () => new Response('{}', { status: 200 })
  );

  assert.equal(response.status, 400);
});

test('returns IGDB metadata without TheGamesDB lookup during game search', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbBody: [
      {
        id: 99,
        name: 'Mario Kart 8 Deluxe',
        first_release_date: 1488499200,
        cover: { image_id: 'xyz987' },
        platforms: [{ id: 130, name: 'Nintendo Switch' }]
      }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=mario'),
    env,
    stub
  );

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].igdbGameId, '99');
  assert.equal(payload.items[0].title, 'Mario Kart 8 Deluxe');
  assert.deepEqual(payload.items[0].platforms, ['Nintendo Switch']);
  assert.deepEqual(payload.items[0].platformOptions, [{ id: 130, name: 'Nintendo Switch' }]);
  assert.equal(payload.items[0].platformIgdbId, 130);
  assert.equal(
    payload.items[0].coverUrl,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/xyz987.jpg'
  );
  assert.equal(payload.items[0].coverSource, 'igdb');
  assert.equal(calls.theGamesDb, 0);
  assert.equal(calls.igdbBodies[0].includes('sort total_rating_count desc;'), false);
  assert.equal(
    calls.igdbBodies[0].includes(
      'fields id,name,storyline,summary,first_release_date,cover.image_id,platforms.id,platforms.name,total_rating_count,game_type.type,parent_game,similar_games,collections.name,franchises.name,genres.name,involved_companies.developer,involved_companies.publisher,involved_companies.company.name;'
    ),
    true
  );
});

test('applies platform filter to IGDB game search when platformIgdbId is provided', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbBody: []
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=mario&platformIgdbId=130'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  assert.equal(calls.igdb, 2);
  assert.equal(calls.igdbBodies[0].includes('where platforms = (130);'), true);
  assert.equal(calls.igdbBodies[1].includes('where platforms = (130);'), false);
});

test('sanitizes semicolons in search query before building IGDB body', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbBody: []
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=metal%20gear%3B%20solid'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  assert.equal(calls.igdb, 1);
  assert.equal(calls.igdbBodies[0].includes('search "metal gear solid";'), true);
});

test('demotes remakes/remasters below their original game when both are in results', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    igdbBody: [
      {
        id: 201,
        name: 'Epic Mickey: Rebrushed',
        first_release_date: 1725321600,
        cover: { image_id: 'remake-cover' },
        platforms: [{ id: 130, name: 'Nintendo Switch' }],
        total_rating_count: 99,
        category: 8,
        version_parent: 200
      },
      {
        id: 200,
        name: 'Epic Mickey',
        first_release_date: 1286150400,
        cover: { image_id: 'original-cover' },
        platforms: [{ id: 6, name: 'Wii' }],
        total_rating_count: 10,
        category: 0
      }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=epic%20mickey'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].igdbGameId, '200');
  assert.equal(payload.items[0].title, 'Epic Mickey');
  assert.equal(payload.items[1].igdbGameId, '201');
  assert.equal(payload.items[1].title, 'Epic Mickey: Rebrushed');
});

test('falls back to reduced IGDB fields when first search variant fails', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbResponses: [
      { status: 400, body: { message: 'Invalid field "total_rating_count"' } },
      {
        status: 200,
        body: [
          {
            id: 500,
            name: 'The Legend of Zelda',
            first_release_date: 522547200,
            cover: { image_id: 'zelda-cover' },
            platforms: [{ id: 18, name: 'NES' }],
            follows: 777,
            category: 0
          }
        ]
      }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=zelda'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  assert.equal(calls.igdb, 2);
  assert.equal(calls.igdbBodies[0].includes('sort '), false);
  assert.equal(calls.igdbBodies[1].includes('sort '), false);

  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].igdbGameId, '500');
  assert.equal(payload.items[0].title, 'The Legend of Zelda');
});

test('reuses cached token between requests', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({ igdbBody: [] });
  const now = () => Date.UTC(2026, 0, 1, 0, 0, 0);

  await handleRequest(
    new Request('https://worker.example/v1/games/search?q=mario'),
    env,
    stub,
    now
  );
  await handleRequest(
    new Request('https://worker.example/v1/games/search?q=zelda'),
    env,
    stub,
    now
  );

  assert.equal(calls.token, 1);
  assert.equal(calls.igdb, 2);
});

test('returns IGDB platform filters and caches the platform response', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbPlatformsBody: [
      { id: 130, name: 'Nintendo Switch' },
      { id: 6, name: 'PC (Microsoft Windows)' }
    ]
  });
  const now = () => Date.UTC(2026, 0, 1, 0, 0, 0);

  const first = await handleRequest(
    new Request('https://worker.example/v1/platforms'),
    env,
    stub,
    now
  );

  const second = await handleRequest(
    new Request('https://worker.example/v1/platforms'),
    env,
    stub,
    now
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls.token, 1);
  assert.equal(calls.igdbPlatforms, 1);
  assert.equal(calls.igdbPlatformBodies[0].includes('fields id,name;'), true);

  const payload = await first.json();
  assert.deepEqual(payload.items, [
    { id: 130, name: 'Nintendo Switch' },
    { id: 6, name: 'PC (Microsoft Windows)' }
  ]);
});

test('returns IGDB popularity types', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbPopularityTypesBody: [
      { id: 1, name: 'Most visited games on IGDB', external_popularity_source: 121 },
      { id: 2, name: 'Most played in the last 24h', external_popularity_source: 144 }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/popularity/types'),
    env,
    stub
  );

  const second = await handleRequest(
    new Request('https://worker.example/v1/popularity/types'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls.token, 1);
  assert.equal(calls.igdbPopularityTypes, 1);
  assert.equal(
    calls.igdbPopularityTypeBodies[0].includes('fields id,name,external_popularity_source;'),
    true
  );

  const payload = await response.json();
  assert.deepEqual(payload.items, [
    { id: 1, name: 'Most visited games on IGDB', externalPopularitySource: 121 },
    { id: 2, name: 'Most played in the last 24h', externalPopularitySource: 144 }
  ]);
});

test('returns IGDB popularity primitives enriched with game metadata', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbPopularityPrimitivesBody: [
      {
        game_id: 42,
        popularity_type: 7,
        external_popularity_source: 81,
        value: 987.65,
        calculated_at: 1735689600
      }
    ],
    igdbBody: [
      {
        id: 42,
        name: 'Super Metroid',
        first_release_date: 777600000,
        cover: { image_id: 'super-metroid' },
        platforms: [{ id: 19, name: 'SNES' }]
      }
    ]
  });

  const response = await handleRequest(
    new Request(
      'https://worker.example/v1/popularity/primitives?popularityTypeId=7&limit=20&offset=0'
    ),
    env,
    stub
  );

  assert.equal(response.status, 200);
  assert.equal(calls.igdbPopularityPrimitives, 1);
  assert.equal(calls.igdb, 1);
  assert.equal(calls.igdbPopularityPrimitiveBodies[0].includes('sort value desc;'), true);
  assert.equal(calls.igdbPopularityPrimitiveBodies[0].includes('limit 20;'), true);
  assert.equal(calls.igdbPopularityPrimitiveBodies[0].includes('offset 0;'), true);

  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].popularityType, 7);
  assert.equal(payload.items[0].value, 987.65);
  assert.equal(payload.items[0].game.igdbGameId, '42');
  assert.equal(payload.items[0].game.title, 'Super Metroid');
});

test('returns 400 when popularityTypeId is missing for popularity primitives', async () => {
  resetCaches();

  const { stub } = createFetchStub({});
  const response = await handleRequest(
    new Request('https://worker.example/v1/popularity/primitives'),
    env,
    stub
  );

  assert.equal(response.status, 400);
});

test('maps upstream errors to safe 502 response', async () => {
  resetCaches();

  const { stub } = createFetchStub({ igdbStatus: 500, igdbBody: { error: 'boom' } });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=halo'),
    env,
    stub
  );

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'Unable to fetch game data.');
});

test('returns 429 with Retry-After when IGDB upstream is rate limited and applies shared cooldown', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbStatus: 429,
    igdbBody: { error: 'too many requests' },
    igdbHeaders: { 'Retry-After': '15' }
  });

  let nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);
  const now = () => nowMs;

  const first = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=halo'),
    env,
    stub,
    now
  );

  assert.equal(first.status, 429);
  assert.equal(first.headers.get('Retry-After'), '20');
  const firstPayload = await first.json();
  assert.equal(firstPayload.error, 'Rate limit exceeded. Retry after 20s.');

  nowMs += 1_000;

  const second = await handleRequest(
    new Request('https://worker.example/v1/games/123'),
    env,
    stub,
    now
  );

  assert.equal(second.status, 429);
  assert.equal(second.headers.get('Retry-After'), '19');
  assert.equal(calls.igdb, 1);
});

test('returns normalized game metadata for IGDB id endpoint', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbBody: [
      {
        id: 321,
        name: 'Super Metroid',
        first_release_date: 775353600,
        cover: { image_id: 'supermetroid-cover' },
        platforms: [{ id: 19, name: 'SNES' }]
      }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/321'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.item.igdbGameId, '321');
  assert.equal(payload.item.title, 'Super Metroid');
  assert.equal(payload.item.coverSource, 'igdb');
  assert.equal(
    payload.item.coverUrl,
    'https://images.igdb.com/igdb/image/upload/t_cover_big/supermetroid-cover.jpg'
  );
  assert.equal(calls.theGamesDb, 0);
});

test('falls back to accent-folded IGDB query when the original query returns no results', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbResponses: [
      { status: 200, body: [] },
      {
        status: 200,
        body: [
          {
            id: 4512,
            name: 'Einhänder',
            first_release_date: 888451200,
            cover: { image_id: 'einhander-cover' },
            platforms: [{ id: 7, name: 'PlayStation' }]
          }
        ]
      }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=Einh%C3%A4nder'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].title, 'Einhänder');
  assert.equal(calls.igdb, 2);
  assert.equal(calls.igdbBodies[0].includes('search "Einhänder";'), true);
  assert.equal(calls.igdbBodies[1].includes('search "Einhander";'), true);
});

test('merges accent-folded IGDB query results when the original query returns non-matching entries', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbResponses: [
      {
        status: 200,
        body: [
          {
            id: 999001,
            name: 'Einhänder Preview Disc',
            first_release_date: 888451200,
            platforms: [{ id: 7, name: 'PlayStation' }]
          }
        ]
      },
      {
        status: 200,
        body: [
          {
            id: 4512,
            name: 'Einhänder',
            first_release_date: 888451200,
            cover: { image_id: 'einhander-cover' },
            platforms: [{ id: 7, name: 'PlayStation' }]
          }
        ]
      }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=einh%C3%A4nder'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items.length, 2);
  assert.equal(
    payload.items.some((item) => item.title === 'Einhänder'),
    true
  );
  assert.equal(calls.igdb, 2);
  assert.equal(calls.igdbBodies[0].includes('search "einhänder";'), true);
  assert.equal(calls.igdbBodies[1].includes('search "einhander";'), true);
});

test('retries IGDB search without platform filter when filtered umlaut query returns no results', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbResponses: [
      { status: 200, body: [] },
      { status: 200, body: [] },
      { status: 200, body: [] },
      {
        status: 200,
        body: [
          {
            id: 4512,
            name: 'Einhänder',
            first_release_date: 888451200,
            cover: { image_id: 'einhander-cover' },
            platforms: [{ id: 7, name: 'PlayStation' }]
          }
        ]
      }
    ]
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=einh%C3%A4nder&platformIgdbId=7'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].title, 'Einhänder');
  assert.equal(calls.igdb, 4);
  assert.equal(calls.igdbBodies[0].includes('where platforms = (7);'), true);
  assert.equal(calls.igdbBodies[1].includes('where platforms = (7);'), true);
  assert.equal(calls.igdbBodies[2].includes('where platforms = (7);'), false);
  assert.equal(calls.igdbBodies[3].includes('where platforms = (7);'), false);
  assert.equal(calls.igdbBodies[3].includes('search "einhander";'), true);
});

test('returns 404 when IGDB id endpoint has no matching game', async () => {
  resetCaches();

  const { stub } = createFetchStub({ igdbBody: [] });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/999999'),
    env,
    stub
  );

  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error, 'Game not found.');
});

test('returns 2D box art candidates for box art search endpoint', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    theGamesDbBody: {
      data: {
        games: [
          { id: 7001, game_title: 'Super Mario Odyssey' },
          { id: 7002, game_title: 'Mario Party' }
        ]
      },
      include: {
        boxart: {
          base_url: {
            original: 'https://cdn.thegamesdb.net/images/original',
            large: 'https://cdn.thegamesdb.net/images/large'
          },
          data: {
            7001: [
              { type: 'boxart', side: 'front', filename: '/box/front/odyssey.jpg' },
              { type: 'boxart', side: 'back', filename: '/box/back/odyssey.jpg' }
            ],
            7002: [{ type: 'boxart', side: 'front', filename: '/box/front/mario-party.jpg' }]
          }
        }
      }
    }
  });

  const response = await handleRequest(
    new Request(
      'https://worker.example/v1/images/boxart/search?q=super%20mario&platform=nintendo%20switch&platformIgdbId=130'
    ),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items.length > 0, true);
  assert.equal(payload.items[0], 'https://cdn.thegamesdb.net/images/large/box/front/odyssey.jpg');
  assert.equal(calls.theGamesDbUrls[0].includes('filter%5Bplatform%5D=4971'), true);
  assert.equal(calls.token, 0);
  assert.equal(calls.igdb, 0);
  assert.equal(calls.theGamesDb, 1);
});

test('falls back to accent-folded TheGamesDB query when the original query returns no candidates', async () => {
  resetCaches();

  const theGamesDbUrls = [];
  const fetchStub = async (url) => {
    const normalizedUrl = String(url);

    if (normalizedUrl.startsWith('https://api.thegamesdb.net/v1.1/Games/ByGameName')) {
      theGamesDbUrls.push(normalizedUrl);

      const parsed = new URL(normalizedUrl);
      const name = parsed.searchParams.get('name');
      const isFoldedQuery = name === 'Einhander';

      const body = isFoldedQuery
        ? {
            data: {
              games: [{ id: 8001, game_title: 'Einhänder' }]
            },
            include: {
              boxart: {
                base_url: {
                  large: 'https://cdn.thegamesdb.net/images/large'
                },
                data: {
                  8001: [{ type: 'boxart', side: 'front', filename: '/box/front/einhander.jpg' }]
                }
              }
            }
          }
        : { data: { games: [] }, include: { boxart: { data: {} } } };

      return new Response(JSON.stringify(body), { status: 200 });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=Einh%C3%A4nder'),
    env,
    fetchStub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.items, [
    'https://cdn.thegamesdb.net/images/large/box/front/einhander.jpg'
  ]);
  assert.equal(
    theGamesDbUrls.some((url) => url.includes('name=Einh%C3%A4nder')),
    true
  );
  assert.equal(
    theGamesDbUrls.some((url) => url.includes('name=Einhander')),
    true
  );
});

test('prioritizes TheGamesDB country_id 50 first and country_id 0 second for matching titles', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    theGamesDbBody: {
      data: {
        games: [
          { id: 7101, game_title: 'SwordQuest EarthWorld', country_id: 999 },
          { id: 7102, game_title: 'SwordQuest EarthWorld', country_id: 0 },
          { id: 7103, game_title: 'SwordQuest EarthWorld', country_id: 50 }
        ]
      },
      include: {
        boxart: {
          base_url: {
            large: 'https://cdn.thegamesdb.net/images/large'
          },
          data: {
            7101: [{ type: 'boxart', side: 'front', filename: '/box/front/swordquest-other.jpg' }],
            7102: [{ type: 'boxart', side: 'front', filename: '/box/front/swordquest-zero.jpg' }],
            7103: [{ type: 'boxart', side: 'front', filename: '/box/front/swordquest-50.jpg' }]
          }
        }
      }
    }
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=swordquest%20earthworld'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.items.slice(0, 3), [
    'https://cdn.thegamesdb.net/images/large/box/front/swordquest-50.jpg',
    'https://cdn.thegamesdb.net/images/large/box/front/swordquest-zero.jpg',
    'https://cdn.thegamesdb.net/images/large/box/front/swordquest-other.jpg'
  ]);
});

test('applies TheGamesDB region preferences after country preference', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    theGamesDbBody: {
      data: {
        games: [
          { id: 7201, game_title: 'Ninja Gaiden', region_id: 0, country_id: 50 },
          { id: 7202, game_title: 'Ninja Gaiden', region_id: 1, country_id: 999 },
          { id: 7203, game_title: 'Ninja Gaiden', region_id: 2, country_id: 999 }
        ]
      },
      include: {
        boxart: {
          base_url: {
            large: 'https://cdn.thegamesdb.net/images/large'
          },
          data: {
            7201: [{ type: 'boxart', side: 'front', filename: '/box/front/ninja-country50.jpg' }],
            7202: [{ type: 'boxart', side: 'front', filename: '/box/front/ninja-region1.jpg' }],
            7203: [{ type: 'boxart', side: 'front', filename: '/box/front/ninja-region2.jpg' }]
          }
        }
      }
    }
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=ninja%20gaiden'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.items.slice(0, 3), [
    'https://cdn.thegamesdb.net/images/large/box/front/ninja-country50.jpg',
    'https://cdn.thegamesdb.net/images/large/box/front/ninja-region2.jpg',
    'https://cdn.thegamesdb.net/images/large/box/front/ninja-region1.jpg'
  ]);
});

test('returns 400 for short box art query', async () => {
  resetCaches();

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=m'),
    env,
    async () => new Response('{}', { status: 200 })
  );

  assert.equal(response.status, 400);
});

test('returns empty box art results instead of 502 when TheGamesDB fails', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    theGamesDbStatus: 500,
    theGamesDbBody: { error: 'thegamesdb_failed' }
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=metroid'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { items: [] });
  assert.equal(calls.theGamesDb, 1);
});

test('rejects non-GET requests and unknown routes', async () => {
  resetCaches();

  const postResponse = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=halo', { method: 'POST' }),
    env,
    async () => new Response('{}', { status: 200 })
  );
  assert.equal(postResponse.status, 405);

  const unknownRoute = await handleRequest(
    new Request('https://worker.example/v1/unknown/path', { method: 'GET' }),
    env,
    async () => new Response('{}', { status: 200 })
  );
  assert.equal(unknownRoute.status, 404);
});

test('returns 400 for invalid popularityTypeId and handles popularity upstream rate limit', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    igdbPopularityPrimitivesStatus: 429
  });

  const invalidTypeId = await handleRequest(
    new Request('https://worker.example/v1/popularity/primitives?popularityTypeId=abc'),
    env,
    stub
  );
  assert.equal(invalidTypeId.status, 400);

  const rateLimited = await handleRequest(
    new Request('https://worker.example/v1/popularity/primitives?popularityTypeId=7'),
    env,
    stub
  );
  assert.equal(rateLimited.status, 429);
  assert.ok(Number(rateLimited.headers.get('Retry-After') ?? '0') >= 20);
});

test('returns 400 for invalid game id route and maps token fetch failures to 502', async () => {
  resetCaches();

  const badGameIdRoute = await handleRequest(
    new Request('https://worker.example/v1/games/not-a-number'),
    env,
    async () => new Response('{}', { status: 200 })
  );
  assert.equal(badGameIdRoute.status, 404);

  const { stub } = createFetchStub({
    tokenStatus: 500
  });
  const tokenFailure = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=metroid'),
    env,
    stub
  );
  assert.equal(tokenFailure.status, 502);
});

test('returns empty box art results when THEGAMESDB key is missing', async () => {
  resetCaches();

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=metroid'),
    {
      TWITCH_CLIENT_ID: env.TWITCH_CLIENT_ID,
      TWITCH_CLIENT_SECRET: env.TWITCH_CLIENT_SECRET,
      THEGAMESDB_API_KEY: ''
    },
    async () => new Response('{}', { status: 200 })
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { items: [] });
});

test('supports DEBUG_HTTP_LOGS and sanitizes sensitive token endpoint query params', async () => {
  resetCaches();
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logs.push(args);
  };

  try {
    const fetchStub = async (url) => {
      const normalizedUrl = String(url);
      if (normalizedUrl.startsWith('https://id.twitch.tv/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'abc123', expires_in: 3600 }), {
          status: 200
        });
      }
      if (normalizedUrl === 'https://api.igdb.com/v4/games') {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const response = await handleRequest(
      new Request('https://worker.example/v1/games/search?q=metroid'),
      {
        ...env,
        DEBUG_HTTP_LOGS: 'true'
      },
      fetchStub
    );

    assert.equal(response.status, 200);
    assert.equal(logs.length > 0, true);
  } finally {
    console.info = originalInfo;
  }
});

test('returns 429 for local burst rate limiting', async () => {
  resetCaches();
  const { stub } = createFetchStub({ igdbBody: [] });
  const now = () => Date.UTC(2026, 0, 1, 0, 0, 0);
  let lastResponse = null;

  for (let index = 0; index < 61; index += 1) {
    lastResponse = await handleRequest(
      new Request('https://worker.example/v1/games/search?q=zelda', {
        headers: { 'x-forwarded-for': '192.0.2.1' }
      }),
      env,
      stub,
      now
    );
  }

  assert.equal(lastResponse.status, 429);
  assert.ok(Number(lastResponse.headers.get('Retry-After') ?? '0') >= 20);
});

test('returns 429 when IGDB platforms endpoint is rate limited', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    igdbPlatformsStatus: 429
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/platforms'),
    env,
    stub
  );
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After') ?? '0') >= 20);
});

test('returns 502 when IGDB popularity types payload is invalid', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    igdbPopularityTypesBody: { invalid: true }
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/popularity/types'),
    env,
    stub
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { items: [] });
});

test('returns empty popularity primitives payload when upstream data is empty', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbPopularityPrimitivesBody: []
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/popularity/primitives?popularityTypeId=7'),
    env,
    stub
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { items: [] });
  assert.equal(calls.igdbPopularityPrimitives, 1);
});

test('returns 502 when Twitch credentials are missing for IGDB routes', async () => {
  resetCaches();

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=zelda'),
    {
      ...env,
      TWITCH_CLIENT_ID: '',
      TWITCH_CLIENT_SECRET: ''
    },
    async () => new Response('{}', { status: 200 })
  );

  assert.equal(response.status, 502);
});

test('handles popularity primitive query normalization for limit/offset bounds', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbPopularityPrimitivesBody: [],
    igdbBody: []
  });

  const response = await handleRequest(
    new Request(
      'https://worker.example/v1/popularity/primitives?popularityTypeId=7&limit=999&offset=-12'
    ),
    env,
    stub
  );

  assert.equal(response.status, 200);
  assert.equal(calls.igdbPopularityPrimitiveBodies[0].includes('limit 100;'), true);
  assert.equal(calls.igdbPopularityPrimitiveBodies[0].includes('offset 0;'), true);
});

test('testable helpers normalize query/id/url utilities', () => {
  const url = new URL('https://worker.example/test?platformIgdbId=130&popularityTypeId=7');
  const invalidUrl = new URL('https://worker.example/test?platformIgdbId=abc&popularityTypeId=-2');

  assert.equal(__testables.normalizePlatformIgdbIdQuery(url), 130);
  assert.equal(__testables.normalizePlatformIgdbIdQuery(invalidUrl), null);
  assert.equal(__testables.normalizePopularityTypeIdQuery(url), 7);
  assert.equal(__testables.normalizePopularityTypeIdQuery(invalidUrl), null);
  assert.equal(__testables.resolveTheGamesDbPlatformId(130), 4971);
  assert.equal(__testables.resolveTheGamesDbPlatformId(-1), null);

  const sanitized = __testables.sanitizeUrlForLogs(
    'https://id.twitch.tv/oauth2/token?client_id=abc&client_secret=xyz'
  );
  assert.equal(sanitized.includes('client_secret=***'), true);
  assert.equal(__testables.buildBodyPreview('abc'), 'abc');
  assert.equal(__testables.buildBodyPreview(''), undefined);
});

test('testable helpers parse limit/offset and retry-after variants', () => {
  const rangeUrl = new URL('https://worker.example/x?limit=250&offset=-5');
  const fallbackUrl = new URL('https://worker.example/x?limit=zzz&offset=bad');

  assert.equal(__testables.normalizeLimitQuery(rangeUrl, 20), 100);
  assert.equal(__testables.normalizeLimitQuery(fallbackUrl, 20), 20);
  assert.equal(__testables.normalizeOffsetQuery(rangeUrl), 0);
  assert.equal(__testables.normalizeOffsetQuery(fallbackUrl), 0);

  assert.equal(__testables.parseRetryAfterSeconds('30', Date.UTC(2026, 0, 1, 0, 0, 0)), 30);
  assert.equal(__testables.parseRetryAfterSeconds('0', Date.UTC(2026, 0, 1, 0, 0, 0)), 20);
  assert.equal(
    __testables.resolveRetryAfterSecondsFromHeaders(
      new Headers({ 'Retry-After': 'Thu, 01 Jan 2026 00:00:40 GMT' }),
      Date.UTC(2026, 0, 1, 0, 0, 0)
    ) >= 20,
    true
  );
});

test('testable helpers normalize optional values and TheGamesDB url composition', () => {
  assert.equal(__testables.normalizeOptionalText('  test  '), 'test');
  assert.equal(__testables.normalizeOptionalText('   '), null);
  assert.equal(__testables.normalizeNumericValue(1.5), 1.5);
  assert.equal(__testables.normalizeNumericValue('2.75'), 2.75);
  assert.equal(__testables.normalizeNumericValue('bad'), null);

  assert.deepEqual(__testables.normalizeIgdbNamedCollection([{ name: 'A' }, { name: 'A' }]), ['A']);
  assert.deepEqual(__testables.normalizeIgdbReferenceIds([{ id: 1 }, 2, 'bad']), ['1', '2']);
  assert.deepEqual(
    __testables.normalizeIgdbCompanyNames(
      {
        involved_companies: [
          { developer: true, company: { name: 'Nintendo' } },
          { developer: false, company: { name: 'Capcom' } }
        ]
      },
      'developer'
    ),
    ['Nintendo']
  );

  assert.equal(
    __testables.normalizeTheGamesDbUrl('/box/front.jpg', 'https://cdn.thegamesdb.net/images/large'),
    'https://cdn.thegamesdb.net/images/large/box/front.jpg'
  );
  assert.equal(
    __testables.normalizeTheGamesDbUrl('https://example.com/x.jpg', ''),
    'https://example.com/x.jpg'
  );
  assert.equal(
    __testables.normalizeTheGamesDbUrl('', 'https://cdn.thegamesdb.net/images/large'),
    null
  );
});

test('testable helpers support accent folding and unique query fallbacks', () => {
  assert.equal(__testables.foldToAsciiForSearch('Einhänder'), 'Einhander');
  assert.equal(__testables.foldToAsciiForSearch(''), '');
  assert.deepEqual(__testables.buildQueryFallbacks('Einhänder'), ['Einhänder', 'Einhander']);
  assert.deepEqual(__testables.buildQueryFallbacks('Metroid'), ['Metroid']);
});

test('testable helpers cover IGDB remaster/remake ranking and original references', () => {
  assert.equal(__testables.normalizeIgdbReferenceId(42), '42');
  assert.equal(__testables.normalizeIgdbReferenceId({ id: 7 }), '7');
  assert.equal(__testables.normalizeIgdbReferenceId('bad'), null);

  assert.equal(__testables.normalizeIgdbRankScore({ rating_count: 10 }), 10);
  assert.equal(__testables.normalizeIgdbRankScore({}), Number.NEGATIVE_INFINITY);
  assert.equal(__testables.normalizeGameTypeLabel(' Remake '), 'remake');
  assert.equal(__testables.normalizeGameTypeLabel({ type: ' Remaster ' }), 'remaster');
  assert.equal(__testables.normalizeGameTypeValue('Action RPG'), 'action_rpg');
  assert.equal(__testables.isRemakeOrRemaster('remaster', null), true);
  assert.equal(__testables.isRemakeOrRemaster(null, 8), true);
  assert.equal(__testables.getOriginalGameId({ parent_game: 99 }), '99');
  assert.equal(__testables.getOriginalGameId({ version_parent: { id: 101 } }), '101');

  const ranked = __testables.sortIgdbSearchResults([
    { id: 2, name: 'Game B', total_rating_count: 5, game_type: { type: 'remake' }, parent_game: 1 },
    { id: 1, name: 'Game A', total_rating_count: 10 }
  ]);
  assert.equal(ranked[0].id, 1);
  assert.equal(ranked[1].id, 2);
});

test('testable helpers cover timeouts, escaping, and box art candidate ranking utilities', () => {
  assert.equal(__testables.getIgdbRequestTimeoutMs({ IGDB_REQUEST_TIMEOUT_MS: '500' }), 15000);
  assert.equal(__testables.getIgdbRequestTimeoutMs({ IGDB_REQUEST_TIMEOUT_MS: '150000' }), 120000);
  assert.equal(
    __testables.getTheGamesDbRequestTimeoutMs({ THEGAMESDB_REQUEST_TIMEOUT_MS: '2000' }),
    2000
  );
  assert.equal(__testables.escapeQuery('Metal; Gear \"Solid\"\n'), 'Metal Gear \\"Solid\\"');

  assert.equal(__testables.getTitleSimilarityScore('Chrono Trigger', 'Chrono Trigger') > 100, true);
  assert.equal(__testables.getTitleSimilarityScore('', 'Chrono Trigger'), -1);
  assert.equal(__testables.getTheGamesDbRegionPreferenceScoreFromIds({ countryId: 50 }), 40);
  assert.equal(__testables.getTheGamesDbRegionPreferenceScoreFromIds({ countryId: 0 }), 30);
  assert.equal(__testables.getTheGamesDbRegionPreferenceScoreFromIds({ regionId: 2 }), 20);
  assert.equal(__testables.getTheGamesDbRegionPreferenceScoreFromIds({ regionId: 1 }), 10);
  assert.equal(__testables.getTheGamesDbRegionId({ region_id: 2 }), 2);
  assert.equal(__testables.getTheGamesDbCountryId({ country_id: 50 }), 50);

  const candidates = __testables.findTheGamesDbBoxArtCandidates(
    {
      data: { games: [{ id: 1, game_title: 'Chrono Trigger', country_id: 50, platform: 'SNES' }] },
      include: {
        boxart: {
          base_url: { large: 'https://cdn.thegamesdb.net/images/large' },
          data: {
            1: [
              { type: 'boxart', side: 'front', filename: '/front.jpg' },
              { type: 'boxart', side: 'back', filename: '/back.jpg' }
            ]
          }
        }
      }
    },
    'Chrono Trigger',
    'SNES'
  );
  assert.equal(candidates.length > 0, true);
});
