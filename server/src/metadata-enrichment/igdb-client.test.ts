import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderThrottleError } from '../provider-rate-limit.js';
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
            headers: { 'content-type': 'application/json' },
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
                external_games: [{ external_game_source: 1, uid: '570' }],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    },
  });

  const map = await client.fetchGameMetadataByIds(['10']);
  const item = map.get('10');
  assert.ok(item);
  assert.deepEqual(item.storefrontLinks, [
    {
      provider: 'steam',
      providerLabel: 'Steam',
      url: 'https://store.steampowered.com/app/570',
      sourceKind: 'external_game',
      sourceId: 1,
      sourceName: 'steam',
      uid: '570',
      platformIgdbId: null,
      countryCode: null,
      releaseFormat: null,
      trusted: null,
    },
  ]);
  assert.equal(item.steamAppId, 570);
  assert.equal(
    calls.some((call) => call.body.includes('external_games.external_game_source')),
    true
  );
});

void test('normalizes storefront links from external games and website fallback', async () => {
  const client = new MetadataEnrichmentIgdbClient({
    twitchClientId: 'cid',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    fetchImpl: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('id.twitch.tv/oauth2/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
      }

      if (url.includes('/v4/external_game_sources')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 31, name: 'Xbox Marketplace' },
              { id: 36, name: 'PlayStation Store US' },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        );
      }

      if (url.includes('/v4/website_types')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 17, type: 'gog' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
      }

      if (url.includes('/v4/games')) {
        const body = typeof init?.body === 'string' ? init.body : '';
        if (!body.includes('websites.type')) {
          return Promise.resolve(new Response('[]', { status: 200 }));
        }

        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 14,
                themes: [],
                keywords: [],
                screenshots: [],
                videos: [],
                external_games: [
                  {
                    external_game_source: 36,
                    uid: 'ps-1',
                    url: 'https://store.playstation.com/en-us/product/UP0001-CUSA00001_00-GAMETEST0000001',
                    platform: 167,
                    countries: [840],
                    game_release_format: 1,
                  },
                  {
                    external_game_source: 31,
                    uid: 'xbox-1',
                    url: 'https://www.xbox.com/en-US/games/store/test-game/9NBLGGH12345',
                    platform: 169,
                  },
                ],
                websites: [
                  {
                    type: 17,
                    url: 'https://www.gog.com/en/game/test_game',
                    trusted: true,
                  },
                  {
                    type: 17,
                    url: 'https://www.gog.com/en/game/test_game',
                    trusted: false,
                  },
                ],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    },
  });

  const map = await client.fetchGameMetadataByIds(['14']);
  const item = map.get('14');
  assert.ok(item);
  assert.deepEqual(item.storefrontLinks, [
    {
      provider: 'playstation',
      providerLabel: 'PlayStation',
      url: 'https://store.playstation.com/en-us/product/UP0001-CUSA00001_00-GAMETEST0000001',
      sourceKind: 'external_game',
      sourceId: 36,
      sourceName: 'PlayStation Store US',
      uid: 'ps-1',
      platformIgdbId: 167,
      countryCode: '840',
      releaseFormat: 1,
      trusted: null,
    },
    {
      provider: 'xbox',
      providerLabel: 'Xbox',
      url: 'https://www.xbox.com/en-US/games/store/test-game/9NBLGGH12345',
      sourceKind: 'external_game',
      sourceId: 31,
      sourceName: 'Xbox Marketplace',
      uid: 'xbox-1',
      platformIgdbId: 169,
      countryCode: null,
      releaseFormat: null,
      trusted: null,
    },
    {
      provider: 'gog',
      providerLabel: 'GOG',
      url: 'https://www.gog.com/en/game/test_game',
      sourceKind: 'website',
      sourceId: 17,
      sourceName: 'gog',
      uid: null,
      platformIgdbId: null,
      countryCode: null,
      releaseFormat: null,
      trusted: true,
    },
  ]);
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
            headers: { 'content-type': 'application/json' },
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
                external_games: [{ category: 1, uid: '730' }],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    },
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
            headers: { 'content-type': 'application/json' },
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
                    url: 'https://store.steampowered.com/app/1245620/ELDEN_RING/',
                  },
                ],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    },
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
            headers: { 'content-type': 'application/json' },
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
                external_games: [{ external_game_source: 5, uid: 'gog-12345' }],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    },
  });

  const map = await client.fetchGameMetadataByIds(['13']);
  const item = map.get('13');
  assert.ok(item);
  assert.equal(item.steamAppId, null);
});

void test('metadata enrichment client converts upstream 429 responses into provider throttle errors', async () => {
  const retryAfterSeconds = 42;
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
            headers: { 'content-type': 'application/json' },
          })
        );
      }

      if (url.includes('/v4/games')) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: { 'retry-after': String(retryAfterSeconds) },
          })
        );
      }

      return Promise.resolve(new Response('{}', { status: 404 }));
    },
  });

  await assert.rejects(
    () => client.fetchGameMetadataByIds(['10']),
    /** @returns {boolean} */ (error) =>
      error instanceof ProviderThrottleError &&
      error.policyName === 'igdb_metadata_enrichment' &&
      error.source === 'upstream_429' &&
      error.retryAfterSeconds === retryAfterSeconds &&
      error.message === 'IGDB metadata enrichment request throttled'
  );
});
