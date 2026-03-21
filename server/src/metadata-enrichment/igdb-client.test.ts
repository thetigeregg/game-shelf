import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderThrottleError } from '../provider-rate-limit.js';
import { MetadataEnrichmentIgdbClient } from './igdb-client.js';

interface FetchCall {
  url: string;
  method: string;
  body: string;
}

void test('extracts steam app id from steam website url', async () => {
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
                websites: [{ type: 13, url: 'https://store.steampowered.com/app/570/Dota_2/' }],
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
  assert.deepEqual(item.websites, [
    {
      provider: 'steam',
      providerLabel: 'Steam',
      url: 'https://store.steampowered.com/app/570/Dota_2/',
      typeId: 13,
      typeName: 'Steam',
      trusted: null,
    },
  ]);
  assert.equal(item.steamAppId, 570);
  assert.equal(
    calls.some((call) => call.body.includes('websites.type')),
    true
  );
});

void test('normalizes websites and deduplicates by provider and url', async () => {
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

      if (url.includes('/v4/website_types')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: 13, type: 'steam' },
              { id: 17, type: 'gog' },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          )
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
                websites: [
                  {
                    url: 'https://store.playstation.com/en-us/product/UP0001-CUSA00001_00-GAMETEST0000001',
                    trusted: true,
                  },
                  {
                    url: 'https://www.xbox.com/en-US/games/store/test-game/9NBLGGH12345',
                    trusted: true,
                  },
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
  assert.deepEqual(item.websites, [
    {
      provider: 'playstation',
      providerLabel: 'PlayStation',
      url: 'https://store.playstation.com/en-us/product/UP0001-CUSA00001_00-GAMETEST0000001',
      typeId: null,
      typeName: null,
      trusted: true,
    },
    {
      provider: 'xbox',
      providerLabel: 'Xbox',
      url: 'https://www.xbox.com/en-US/games/store/test-game/9NBLGGH12345',
      typeId: null,
      typeName: null,
      trusted: true,
    },
    {
      provider: 'gog',
      providerLabel: 'GOG',
      url: 'https://www.gog.com/en/game/test_game',
      typeId: 17,
      typeName: 'gog',
      trusted: true,
    },
  ]);
});

void test('derives steam app id from website category and url', async () => {
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
                websites: [{ category: 13, url: 'https://store.steampowered.com/app/730/' }],
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

void test('parses steam app id from website url when no website type name is available', async () => {
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
                websites: [
                  {
                    type: 13,
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

void test('ignores non-steam websites for steam app id derivation', async () => {
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
                websites: [{ type: 17, url: 'https://www.gog.com/en/game/example', trusted: true }],
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
