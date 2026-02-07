import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, normalizeIgdbGame, resetCaches } from '../src/index.mjs';

const env = {
  TWITCH_CLIENT_ID: 'client-id',
  TWITCH_CLIENT_SECRET: 'client-secret',
};

function createFetchStub({ igdbStatus = 200, igdbBody = [], tokenStatus = 200 }) {
  const calls = {
    token: 0,
    igdb: 0,
  };

  const stub = async (url) => {
    if (String(url).startsWith('https://id.twitch.tv/oauth2/token')) {
      calls.token += 1;

      if (tokenStatus !== 200) {
        return new Response(JSON.stringify({ error: 'token_failed' }), { status: tokenStatus });
      }

      return new Response(JSON.stringify({ access_token: 'abc123', expires_in: 3600 }), { status: 200 });
    }

    if (String(url) === 'https://api.igdb.com/v4/games') {
      calls.igdb += 1;
      return new Response(JSON.stringify(igdbBody), { status: igdbStatus });
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
    platform: 'Nintendo Switch',
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

test('returns normalized search results for valid query', async () => {
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
