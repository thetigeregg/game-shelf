import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataEnrichmentIgdbClient } from './igdb-client.js';

interface FetchCall {
  url: string;
  method: string;
  body: string;
}

void test('extracts steam app id from external_game_source uid', async () => {
  const calls: FetchCall[] = [];
  const client = new MetadataEnrichmentIgdbClient({
    twitchClientId: 'cid',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    fetchImpl: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({ url, method, body });

      if (url.includes('id.twitch.tv/oauth2/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.includes('/v4/games')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 10,
                themes: [],
                keywords: [],
                screenshots: [],
                videos: [],
                external_games: [{ external_game_source: 1, uid: '570' }]
              }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    }
  });

  const map = await client.fetchGameMetadataByIds(['10']);
  const item = map.get('10');
  assert.ok(item);
  assert.equal(item.steamAppId, 570);
  assert.equal(
    calls.some((call) => call.body.includes('external_games.external_game_source')),
    true
  );
});

void test('falls back to deprecated category steam enum for steam app id', async () => {
  const client = new MetadataEnrichmentIgdbClient({
    twitchClientId: 'cid',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    fetchImpl: (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('id.twitch.tv/oauth2/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.includes('/v4/games')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 11,
                themes: [],
                keywords: [],
                screenshots: [],
                videos: [],
                external_games: [{ category: 1, uid: '730' }]
              }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    }
  });

  const map = await client.fetchGameMetadataByIds(['11']);
  const item = map.get('11');
  assert.ok(item);
  assert.equal(item.steamAppId, 730);
});

void test('falls back to parsing steam app id from URL when uid is missing', async () => {
  const client = new MetadataEnrichmentIgdbClient({
    twitchClientId: 'cid',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    fetchImpl: (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('id.twitch.tv/oauth2/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.includes('/v4/games')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 12,
                themes: [],
                keywords: [],
                screenshots: [],
                videos: [],
                external_games: [
                  {
                    external_game_source: 1,
                    uid: null,
                    url: 'https://store.steampowered.com/app/1245620/ELDEN_RING/'
                  }
                ]
              }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    }
  });

  const map = await client.fetchGameMetadataByIds(['12']);
  const item = map.get('12');
  assert.ok(item);
  assert.equal(item.steamAppId, 1245620);
});

void test('ignores non-steam external ids', async () => {
  const client = new MetadataEnrichmentIgdbClient({
    twitchClientId: 'cid',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    fetchImpl: (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('id.twitch.tv/oauth2/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        );
      }

      if (url.includes('/v4/games')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 13,
                themes: [],
                keywords: [],
                screenshots: [],
                videos: [],
                external_games: [{ external_game_source: 5, uid: 'gog-12345' }]
              }
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' }
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    }
  });

  const map = await client.fetchGameMetadataByIds(['13']);
  const item = map.get('13');
  assert.ok(item);
  assert.equal(item.steamAppId, null);
});
