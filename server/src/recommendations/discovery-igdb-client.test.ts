import assert from 'node:assert/strict';
import test from 'node:test';
import { ProviderThrottleError } from '../provider-rate-limit.js';
import { DiscoveryIgdbClient } from './discovery-igdb-client.js';

void test('discovery popular query uses game_type and excludes deprecated category filters', async () => {
  const gameRequests: string[] = [];
  const fetchMock: typeof fetch = (input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
        })
      );
    }

    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/games')) {
      const body = typeof _init?.body === 'string' ? _init.body : '';
      gameRequests.push(body);
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: fetchMock,
  });

  await client.fetchDiscoveryCandidatesBySource({
    source: 'popular',
    poolSize: 1,
    preferredPlatformIds: [],
  });

  assert.equal(gameRequests.length, 1);
  const query = gameRequests[0] ?? '';
  assert.match(query, /\bgame_type = \(1\)/);
  assert.doesNotMatch(query, /where[^;]*\bcategory\b/);
  assert.match(query, /sort total_rating_count desc;/);
  assert.match(query, /parent_game = null/);
  assert.match(query, /version_parent = null/);
});

void test('discovery recent query applies quality and release window filters', async () => {
  const gameRequests: string[] = [];
  const fetchMock: typeof fetch = (input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
        })
      );
    }

    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/games')) {
      const body = typeof _init?.body === 'string' ? _init.body : '';
      gameRequests.push(body);
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: fetchMock,
  });

  await client.fetchDiscoveryCandidatesBySource({
    source: 'recent',
    poolSize: 1,
    preferredPlatformIds: [],
  });

  assert.equal(gameRequests.length, 1);
  const query = gameRequests[0] ?? '';
  assert.match(query, /\bfirst_release_date <= \d+/);
  assert.match(query, /\(total_rating_count >= 25 \| aggregated_rating_count >= 25\)/);
  assert.match(query, /sort first_release_date desc;/);
  assert.match(query, /\bgame_type = \(1\)/);
  assert.doesNotMatch(query, /where[^;]*\bcategory\b/);
});

void test('discovery source fetch normalizes payload rows and prioritizes preferred platforms', async () => {
  const fetchMock: typeof fetch = (input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
        })
      );
    }

    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 1, type: 'Main Game' },
            { id: 2, type: 'DLC' },
          ]),
          {
            status: 200,
          }
        )
      );
    }

    if (url.includes('/v4/games')) {
      const body = typeof _init?.body === 'string' ? _init.body : '';
      const sourceScore = body.includes('sort total_rating_count desc') ? 10 : 5;
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 0, name: 'invalid no id' },
            {
              id: 100,
              name: ' Test Game ',
              summary: ' Summary ',
              storyline: ' Storyline ',
              first_release_date: 1_700_000_000,
              platforms: [
                { id: 6, name: 'PC' },
                { id: 6, name: 'PC duplicate' },
                { id: 48, name: 'PS4' },
              ],
              genres: [{ name: 'Action' }, { name: 'Action' }],
              themes: [{ name: 'Fantasy' }],
              keywords: [{ name: 'co-op' }],
              collections: [{ name: 'Series' }],
              franchises: [{ name: 'Franchise' }],
              involved_companies: [
                { developer: true, company: { name: 'Dev' } },
                { publisher: true, company: { name: 'Pub' } },
              ],
              total_rating: 88,
              total_rating_count: sourceScore,
            },
          ]),
          { status: 200 }
        )
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: fetchMock,
  });

  const rows = await client.fetchDiscoveryCandidatesBySource({
    source: 'popular',
    poolSize: 5,
    preferredPlatformIds: [48],
  });

  assert.equal(rows.length, 2);
  assert.ok(rows.some((row) => row.platformIgdbId === 48));
  assert.ok(rows.every((row) => row.payload.title === 'Test Game'));
  const ps4Row = rows.find((row) => row.platformIgdbId === 48);
  assert.ok(ps4Row);
  assert.equal(ps4Row.payload.platform, 'PS4');
  assert.deepEqual(ps4Row.payload.platformOptions, [{ id: 48, name: 'PS4' }]);
  assert.equal(ps4Row.payload.reviewScore, null);
  assert.equal(ps4Row.payload.reviewSource, null);
});

void test('discovery merged fetch dedupes by game/platform and picks highest source score', async () => {
  const fetchMock: typeof fetch = (input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
        })
      );
    }

    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/games')) {
      const body = typeof _init?.body === 'string' ? _init.body : '';
      if (body.includes('sort total_rating_count desc')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 9,
                name: 'Game',
                platforms: [{ id: 6, name: 'PC' }],
                total_rating_count: 500,
                total_rating: 80,
              },
            ]),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 9,
              name: 'Game',
              platforms: [{ id: 6, name: 'PC' }],
              first_release_date: 1_700_000_000,
            },
          ]),
          { status: 200 }
        )
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: fetchMock,
  });

  const rows = await client.fetchDiscoveryCandidates({
    poolSize: 10,
    preferredPlatformIds: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.source, 'recent');
});

void test('discovery source fetch includes storefront links and derived steam app id', async () => {
  const fetchMock: typeof fetch = (input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
          status: 200,
        })
      );
    }

    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/external_game_sources')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, name: 'Steam' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/website_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 17, type: 'GOG' }]), { status: 200 })
      );
    }

    if (url.includes('/v4/games')) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 100,
              name: 'Store Test',
              platforms: [{ id: 6, name: 'PC' }],
              external_games: [{ external_game_source: 1, uid: '570', platform: 6 }],
              websites: [
                { type: 17, url: 'https://www.gog.com/en/game/store_test', trusted: true },
              ],
              total_rating_count: 50,
            },
          ]),
          { status: 200 }
        )
      );
    }

    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: fetchMock,
  });

  const rows = await client.fetchDiscoveryCandidatesBySource({
    source: 'popular',
    poolSize: 1,
    preferredPlatformIds: [],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.payload.steamAppId, 570);
  assert.deepEqual(rows[0]?.payload.storefrontLinks, [
    {
      provider: 'steam',
      providerLabel: 'Steam',
      url: 'https://store.steampowered.com/app/570',
      sourceKind: 'external_game',
      sourceId: 1,
      sourceName: 'Steam',
      uid: '570',
      platformIgdbId: 6,
      countryCode: null,
      releaseFormat: null,
      trusted: null,
    },
    {
      provider: 'gog',
      providerLabel: 'GOG',
      url: 'https://www.gog.com/en/game/store_test',
      sourceKind: 'website',
      sourceId: 17,
      sourceName: 'GOG',
      uid: null,
      platformIgdbId: null,
      countryCode: null,
      releaseFormat: null,
      trusted: true,
    },
  ]);
});

void test('discovery client throws for token and game endpoint failures', async () => {
  const failingTokenFetch: typeof fetch = (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(new Response(null, { status: 500 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const tokenClient = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: failingTokenFetch,
  });
  await assert.rejects(
    () =>
      tokenClient.fetchDiscoveryCandidatesBySource({
        source: 'popular',
        poolSize: 1,
        preferredPlatformIds: [],
      }),
    /Twitch token fetch failed/
  );

  const failingGamesFetch: typeof fetch = (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('id.twitch.tv/oauth2/token')) {
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })
      );
    }
    if (url.includes('/v4/game_types')) {
      return Promise.resolve(
        new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
      );
    }
    if (url.includes('/v4/games')) {
      return Promise.resolve(new Response('upstream-failed', { status: 400 }));
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  };

  const gamesClient = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: failingGamesFetch,
  });
  await assert.rejects(
    () =>
      gamesClient.fetchDiscoveryCandidatesBySource({
        source: 'recent',
        poolSize: 1,
        preferredPlatformIds: [],
      }),
    /IGDB discovery fetch failed/
  );
});

void test('discovery client converts upstream 429 responses into provider throttle errors', async () => {
  const retryAfterSeconds = 42;
  const client = new DiscoveryIgdbClient({
    twitchClientId: 'client',
    twitchClientSecret: 'secret',
    requestTimeoutMs: 5_000,
    maxRequestsPerSecond: 20,
    fetchImpl: (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('id.twitch.tv/oauth2/token')) {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), {
            status: 200,
          })
        );
      }

      if (url.includes('/v4/game_types')) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: 1, type: 'Main Game' }]), { status: 200 })
        );
      }

      if (url.includes('/v4/games')) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: {
              'retry-after': String(retryAfterSeconds),
            },
          })
        );
      }

      return Promise.resolve(new Response(null, { status: 404 }));
    },
  });

  await assert.rejects(
    () =>
      client.fetchDiscoveryCandidatesBySource({
        source: 'popular',
        poolSize: 1,
        preferredPlatformIds: [],
      }),
    /** @returns {boolean} */ (error) =>
      error instanceof ProviderThrottleError &&
      error.policyName === 'igdb_discovery' &&
      error.source === 'upstream_429' &&
      error.retryAfterSeconds === retryAfterSeconds &&
      error.message === 'IGDB discovery request throttled'
  );
});
