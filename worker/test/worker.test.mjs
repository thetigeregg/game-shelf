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
  tokenStatus = 200,
  theGamesDbStatus = 200,
  theGamesDbBody = null,
}) {
  const calls = {
    token: 0,
    igdb: 0,
    theGamesDb: 0,
  };

  const stub = async (url) => {
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
      return new Response(JSON.stringify(igdbBody), { status: igdbStatus });
    }

    if (normalizedUrl.startsWith('https://api.thegamesdb.net/v1.1/Games/ByGameName')) {
      calls.theGamesDb += 1;

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
    platform: 'Nintendo Switch',
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

test('uses TheGamesDB boxart as primary cover image when available', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    igdbBody: [
      {
        id: 99,
        name: 'Mario Kart 8 Deluxe',
        first_release_date: 1488499200,
        cover: { image_id: 'xyz987' },
        platforms: [{ name: 'Nintendo Switch' }],
      },
    ],
    theGamesDbBody: {
      data: {
        games: [{ id: 1001, game_title: 'Mario Kart 8 Deluxe' }],
      },
      include: {
        boxart: {
          base_url: { original: 'https://cdn.thegamesdb.net/images/original' },
          data: {
            1001: [
              { type: 'boxart', side: 'front', filename: '/box/front/mario-kart-8-deluxe.jpg' },
            ],
          },
        },
      },
    },
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
  assert.equal(payload.items[0].coverUrl, 'https://cdn.thegamesdb.net/images/original/box/front/mario-kart-8-deluxe.jpg');
  assert.equal(payload.items[0].coverSource, 'thegamesdb');
});

test('prefers the closest TheGamesDB title match instead of the first result', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    igdbBody: [
      {
        id: 501,
        name: 'Epic Mickey',
        first_release_date: 1286150400,
        cover: { image_id: 'epicmickey-igdb' },
        platforms: [{ name: 'Wii' }],
      },
    ],
    theGamesDbBody: {
      data: {
        games: [
          { id: 3001, game_title: 'Epic Mickey: Rebrushed' },
          { id: 3002, game_title: 'Epic Mickey' },
        ],
      },
      include: {
        boxart: {
          base_url: { original: 'https://cdn.thegamesdb.net/images/original' },
          data: {
            3001: [{ type: 'boxart', side: 'front', filename: '/box/front/epic-mickey-rebrushed.jpg' }],
            3002: [{ type: 'boxart', side: 'front', filename: '/box/front/epic-mickey.jpg' }],
          },
        },
      },
    },
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=epic%20mickey'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items[0].coverUrl, 'https://cdn.thegamesdb.net/images/original/box/front/epic-mickey.jpg');
  assert.equal(payload.items[0].coverSource, 'thegamesdb');
});

test('falls back to IGDB cover when TheGamesDB has no boxart', async () => {
  resetCaches();

  const { stub } = createFetchStub({
    igdbBody: [
      {
        id: 100,
        name: 'Metroid Prime',
        first_release_date: 1044057600,
        cover: { image_id: 'metroid123' },
        platforms: [{ name: 'GameCube' }],
      },
    ],
    theGamesDbBody: {
      data: {
        games: [{ id: 2002, game_title: 'Metroid Prime' }],
      },
      include: {
        boxart: {
          base_url: { original: 'https://cdn.thegamesdb.net/images/original' },
          data: {
            2002: [
              { type: 'screenshot', side: 'front', filename: '/screenshots/metroid-prime.jpg' },
            ],
          },
        },
      },
    },
  });

  const response = await handleRequest(
    new Request('https://worker.example/v1/games/search?q=metroid'),
    env,
    stub,
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.items[0].coverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/metroid123.jpg');
  assert.equal(payload.items[0].coverSource, 'igdb');
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

  const { stub } = createFetchStub({
    igdbBody: [
      {
        id: 321,
        name: 'Super Metroid',
        first_release_date: 775353600,
        cover: { image_id: 'supermetroid-cover' },
        platforms: [{ name: 'SNES' }],
      },
    ],
    theGamesDbBody: {
      data: {
        games: [{ id: 999, game_title: 'Super Metroid' }],
      },
      include: {
        boxart: {
          base_url: { original: 'https://cdn.thegamesdb.net/images/original' },
          data: {
            999: [{ type: 'boxart', side: 'front', filename: '/box/front/super-metroid.jpg' }],
          },
        },
      },
    },
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
  assert.equal(payload.item.coverSource, 'thegamesdb');
  assert.equal(payload.item.coverUrl, 'https://cdn.thegamesdb.net/images/original/box/front/super-metroid.jpg');
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
