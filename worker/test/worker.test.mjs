import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, normalizeIgdbGame, resetCaches } from '../src/index.mjs';

const env = {
  TWITCH_CLIENT_ID: 'client-id',
  TWITCH_CLIENT_SECRET: 'client-secret',
  THEGAMESDB_API_KEY: 'thegamesdb-key',
};

function createFetchStub({
  igdbStatus = 200,
  igdbBody = [],
  igdbResponses = null,
  igdbPlatformsStatus = 200,
  igdbPlatformsBody = [],
  tokenStatus = 200,
  theGamesDbStatus = 200,
  theGamesDbBody = null,
}) {
  const calls = {
    token: 0,
    igdb: 0,
    igdbBodies: [],
    igdbPlatforms: 0,
    igdbPlatformBodies: [],
    theGamesDb: 0,
    theGamesDbUrls: [],
  };

  const stub = async (url, options = {}) => {
    const normalizedUrl = String(url);

    if (normalizedUrl.startsWith('https://id.twitch.tv/oauth2/token')) {
      calls.token += 1;

      if (tokenStatus !== 200) {
        return new Response(JSON.stringify({ error: 'token_failed' }), { status: tokenStatus });
      }

      return new Response(JSON.stringify({ access_token: 'abc123', expires_in: 3600 }), { status: 200 });
    }

    if (normalizedUrl === 'https://api.igdb.com/v4/games') {
      calls.igdb += 1;
      calls.igdbBodies.push(typeof options.body === 'string' ? options.body : '');

      if (Array.isArray(igdbResponses) && igdbResponses.length > 0) {
        const responseConfig = igdbResponses[calls.igdb - 1] ?? igdbResponses[igdbResponses.length - 1];
        return new Response(
          JSON.stringify(responseConfig?.body ?? []),
          { status: responseConfig?.status ?? 200 },
        );
      }

      return new Response(JSON.stringify(igdbBody), { status: igdbStatus });
    }

    if (normalizedUrl === 'https://api.igdb.com/v4/platforms') {
      calls.igdbPlatforms += 1;
      calls.igdbPlatformBodies.push(typeof options.body === 'string' ? options.body : '');
      return new Response(JSON.stringify(igdbPlatformsBody), { status: igdbPlatformsStatus });
    }

    if (normalizedUrl.startsWith('https://api.thegamesdb.net/v1.1/Games/ByGameName')) {
      calls.theGamesDb += 1;
      calls.theGamesDbUrls.push(normalizedUrl);

      if (theGamesDbStatus !== 200) {
        return new Response(JSON.stringify({ error: 'thegamesdb_failed' }), { status: theGamesDbStatus });
      }

      return new Response(JSON.stringify(theGamesDbBody ?? { data: { games: [] }, include: { boxart: { data: {} } } }), { status: 200 });
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
    platforms: [{ name: 'Nintendo Switch' }],
  });

  assert.deepEqual(normalized, {
    externalId: '42',
    title: 'Super Mario Odyssey',
    coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
    coverSource: 'igdb',
    platforms: ['Nintendo Switch'],
    platformOptions: [{ id: null, name: 'Nintendo Switch' }],
    platform: 'Nintendo Switch',
    platformIgdbId: null,
    releaseDate: '2017-10-20T00:00:00.000Z',
    releaseYear: 2017,
  });
});

test('returns 400 for short query', async () => {
  resetCaches();

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=m'),
    env,
    async () => new Response('{}', { status: 200 }),
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
        platforms: [{ id: 130, name: 'Nintendo Switch' }],
      },
    ],
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=mario'),
    env,
    stub,
  );

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].externalId, '99');
  assert.equal(payload.items[0].title, 'Mario Kart 8 Deluxe');
  assert.deepEqual(payload.items[0].platforms, ['Nintendo Switch']);
  assert.deepEqual(payload.items[0].platformOptions, [{ id: 130, name: 'Nintendo Switch' }]);
  assert.equal(payload.items[0].platformIgdbId, 130);
  assert.equal(payload.items[0].coverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/xyz987.jpg');
  assert.equal(payload.items[0].coverSource, 'igdb');
  assert.equal(calls.theGamesDb, 0);
  assert.equal(calls.igdbBodies[0].includes('sort total_rating_count desc;'), false);
  assert.equal(calls.igdbBodies[0].includes('fields id,name,first_release_date,cover.image_id,platforms.id,platforms.name,total_rating_count,category,parent_game;'), true);
});

test('applies platform filter to IGDB game search when platformIgdbId is provided', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbBody: [],
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=mario&platformIgdbId=130'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  assert.equal(calls.igdb, 1);
  assert.equal(calls.igdbBodies[0].includes('where platforms = (130);'), true);
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
        version_parent: 200,
      },
      {
        id: 200,
        name: 'Epic Mickey',
        first_release_date: 1286150400,
        cover: { image_id: 'original-cover' },
        platforms: [{ id: 6, name: 'Wii' }],
        total_rating_count: 10,
        category: 0,
      },
    ],
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=epic%20mickey'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].externalId, '200');
  assert.equal(payload.items[0].title, 'Epic Mickey');
  assert.equal(payload.items[1].externalId, '201');
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
            category: 0,
          },
        ],
      },
    ],
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=zelda'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  assert.equal(calls.igdb, 2);
  assert.equal(calls.igdbBodies[0].includes('sort '), false);
  assert.equal(calls.igdbBodies[1].includes('sort '), false);

  const payload = await response.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].externalId, '500');
  assert.equal(payload.items[0].title, 'The Legend of Zelda');
});

test('reuses cached token between requests', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({ igdbBody: [] });
  const now = () => Date.UTC(2026, 0, 1, 0, 0, 0);

  await handleRequest(new Request('https://worker.example/v1/games/search?q=mario'), env, stub, now);
  await handleRequest(new Request('https://worker.example/v1/games/search?q=zelda'), env, stub, now);

  assert.equal(calls.token, 1);
  assert.equal(calls.igdb, 2);
});

test('returns IGDB platform filters and caches the platform response', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    igdbPlatformsBody: [
      { id: 130, name: 'Nintendo Switch' },
      { id: 6, name: 'PC (Microsoft Windows)' },
    ],
  });
  const now = () => Date.UTC(2026, 0, 1, 0, 0, 0);

  const first = await handleRequest(
    new Request('https://worker.example/v1/platforms'),
    env,
    stub,
    now,
  );

  const second = await handleRequest(
    new Request('https://worker.example/v1/platforms'),
    env,
    stub,
    now,
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(calls.token, 1);
  assert.equal(calls.igdbPlatforms, 1);
  assert.equal(calls.igdbPlatformBodies[0].includes('fields id,name;'), true);

  const payload = await first.json();
  assert.deepEqual(payload.items, [
    { id: 130, name: 'Nintendo Switch' },
    { id: 6, name: 'PC (Microsoft Windows)' },
  ]);
});

test('maps upstream errors to safe 502 response', async () => {
  resetCaches();

  const { stub } = createFetchStub({ igdbStatus: 500, igdbBody: { error: 'boom' } });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=halo'),
    env,
    stub,
  );

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'Unable to fetch game data.');
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
        platforms: [{ id: 19, name: 'SNES' }],
      },
    ],
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/321'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.item.externalId, '321');
  assert.equal(payload.item.title, 'Super Metroid');
  assert.equal(payload.item.coverSource, 'igdb');
  assert.equal(payload.item.coverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/supermetroid-cover.jpg');
  assert.equal(calls.theGamesDb, 0);
});

test('returns 404 when IGDB id endpoint has no matching game', async () => {
  resetCaches();

  const { stub } = createFetchStub({ igdbBody: [] });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/999999'),
    env,
    stub,
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
          { id: 7002, game_title: 'Mario Party' },
        ],
      },
      include: {
        boxart: {
          base_url: { original: 'https://cdn.thegamesdb.net/images/original' },
          data: {
            7001: [
              { type: 'boxart', side: 'front', filename: '/box/front/odyssey.jpg' },
              { type: 'boxart', side: 'back', filename: '/box/back/odyssey.jpg' },
            ],
            7002: [
              { type: 'boxart', side: 'front', filename: '/box/front/mario-party.jpg' },
            ],
          },
        },
      },
    },
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=super%20mario&platform=nintendo%20switch&platformIgdbId=130'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items.length > 0, true);
  assert.equal(payload.items[0], 'https://cdn.thegamesdb.net/images/original/box/front/odyssey.jpg');
  assert.equal(calls.theGamesDbUrls[0].includes('filter%5Bplatform%5D=4971'), true);
  assert.equal(calls.token, 0);
  assert.equal(calls.igdb, 0);
  assert.equal(calls.theGamesDb, 1);
});

test('returns 400 for short box art query', async () => {
  resetCaches();

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=m'),
    env,
    async () => new Response('{}', { status: 200 }),
  );

  assert.equal(response.status, 400);
});

test('returns empty box art results instead of 502 when TheGamesDB fails', async () => {
  resetCaches();

  const { stub, calls } = createFetchStub({
    theGamesDbStatus: 500,
    theGamesDbBody: { error: 'thegamesdb_failed' },
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/images/boxart/search?q=metroid'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload, { items: [] });
  assert.equal(calls.theGamesDb, 1);
});
